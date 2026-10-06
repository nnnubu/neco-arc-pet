/* 渲染进程 - 精灵动画核心
 * 职责：精灵帧加载、动画播放（待机循环 / 走动循环 / 一次性动作）、缩放与窗口适配
 * 对外 API（window.SpriteCore）：
 *   init(app, shared)  绑定 PIXI 应用与共享状态（keys / petScale）
 *   initSprite()       异步加载全部帧并显示待机
 *   update(now, dt)    每帧更新（处理走动与随机动作）
 *   playOneshot(name)  播放一次性动作（不打断走动）
 *   backToIdle()       回到待机
 *   applyPetScale()    应用缩放（窗口 resize 后底部中心对齐）
 */
window.SpriteCore = (() => {
  const SPRITE = {
    groups: ['standing', 'walking_left', 'walking_right', 'running', 'backflip', 'kick', 'thinking', 'wine', 'wine_2',
      'smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie'],
    frameCount: { standing: 9, walking_left: 12, walking_right: 11, running: 11, backflip: 9, kick: 7, thinking: 4, wine: 28, wine_2: 17,
      smug: 5, tongue: 60, push: 10, star: 3, pose1: 3, hide: 3, pout: 8, lie: 8 },
    FPS: 12,
    SCALE: 2,
    sprites: {},
    current: null,
    currentName: '',
    state: 'idle', // idle | walk | oneshot
    oneshotLeft: 0, // 一次性动作剩余播放轮数
    nextActionAt: 0,
  };
  // 需重复播放 3 遍的动作（thinking/push/star/pose1/hide/lie）；其余动作播放一遍即回待机
  const ACTION_REPEATS = { thinking: 3, push: 3, star: 3, pose1: 3, hide: 3, lie: 3 };
  // smug 播完保持最后一帧的时长（2 秒）再回待机
  const SMUG_HOLD_MS = 2000;
  // 循环动画的帧集：排除起跑/爆发/收尾/站立帧，循环衔接才自然
  // - walking：去帧 1 与尾帧（首尾跳变最大）
  // - running：用 ping-pong 往返序列 [4,5,6,7,6,5]——帧 4-7 是奔跑段（帧间差异 ≤6.2%），
  //   往返循环使每帧衔接都是相邻平滑段，彻底没有"跳回开头"的突兀感
  const LOOP_FRAME_SETS = {
    walking_left: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    walking_right: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    running: [4, 5, 6, 7, 6, 5],
  };
  const ONESHOT_NAMES = ['backflip', 'kick', 'wine', 'wine_2', 'thinking',
    'smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie'];

  let app = null;
  let shared = null; // { keys, petScale, maxScale }
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function spriteShow(name, loop, flipX) {
    const s = SPRITE.sprites[name];
    if (!s) return;
    if (SPRITE.current && SPRITE.current !== s) SPRITE.current.visible = false;
    SPRITE.current = s;
    SPRITE.currentName = name;
    s.visible = true;
    const sc = SPRITE.SCALE * shared.petScale;
    s.scale.set(flipX ? -sc : sc, sc);
    s.position.set(window.innerWidth / 2, window.innerHeight - 6);
    s.loop = loop;
    s.gotoAndPlay(0);
  }

  // 应用缩放：更新所有精灵 scale 与位置（窗口 resize 后底部中心对齐）
  function applyPetScale() {
    const sc = SPRITE.SCALE * shared.petScale;
    for (const s of Object.values(SPRITE.sprites)) {
      const flip = s.scale.x < 0;
      s.scale.set((flip ? -1 : 1) * sc, sc);
      s.position.set(window.innerWidth / 2, window.innerHeight - 6);
    }
  }

  function spritePlayOneshot(name) {
    if (SPRITE.state === 'walk') return; // 走动优先，不打断
    SPRITE.oneshotLeft = ACTION_REPEATS[name] || 1;
    spriteShow(name, false, false);
    SPRITE.state = 'oneshot';
  }

  function spriteBackToIdle() {
    if (SPRITE.state === 'walk') return; // 走动中不打断
    SPRITE.state = 'idle';
    spriteShow('standing', true, false);
  }

  async function initSprite() {
    app.stage.removeChildren();
    // 逐组加载帧纹理（走路/跑步跳过首尾帧，循环衔接更自然）
    for (const g of SPRITE.groups) {
      const texs = [];
      const useFrames = LOOP_FRAME_SETS[g] || (() => {
        const f = [];
        for (let i = 1; i <= SPRITE.frameCount[g]; i++) f.push(i);
        return f;
      })();
      for (const f of useFrames) {
        texs.push(await PIXI.Assets.load(`../assets/sprite/animations/${g}/${f}.png`));
      }
      const s = new PIXI.AnimatedSprite(texs);
      s.anchor.set(0.5, 1); // 脚底中心
      s.animationSpeed = SPRITE.FPS / 60; // 统一 12fps（与原始动作一致）
      s.visible = false;
      for (const t of texs) t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      // 一次性动画：指定动作按轮数循环；smug 播完保持最后一帧 2 秒；其余播完直接回待机
      s.onComplete = () => {
        if (SPRITE.state !== 'oneshot' || SPRITE.current !== s) return;
        if (SPRITE.oneshotLeft > 1) { SPRITE.oneshotLeft--; s.gotoAndPlay(0); }
        else if (SPRITE.currentName === 'smug') {
          const cur = s;
          setTimeout(() => {
            if (SPRITE.current === cur && SPRITE.state === 'oneshot') spriteBackToIdle();
          }, SMUG_HOLD_MS);
        } else {
          spriteBackToIdle();
        }
      };
      app.stage.addChild(s);
      SPRITE.sprites[g] = s;
    }
    SPRITE.state = 'idle';
    SPRITE.nextActionAt = Date.now() + rand(8000, 15000);
    spriteShow('standing', true, false);
    window.pet.resizeWindow(440, 530);
  }

  // 每帧更新：走动（按键持续循环播放）、待机随机动作
  function update(now, dt) {
    const keys = shared.keys;
    const vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const moving = vx !== 0 || vy !== 0;

    if (moving) {
      // 按住方向键持续移动，动画循环播放直至抬键
      const run = keys.shift;
      const spd = run ? 430 : 260;
      window.pet.moveBy(Math.round(vx * spd * dt), Math.round(vy * spd * dt));
      // 目标动画：跑 / 左右走（方向变化时立即切换动画组）
      const targetAnim = run ? 'running'
        : (vx !== 0 ? (vx > 0 ? 'walking_right' : 'walking_left')
          : (SPRITE.currentName === 'walking_right' ? 'walking_right' : 'walking_left'));
      const flipX = run && vx < 0; // running 只有朝右的帧，向左跑时水平翻转
      if (SPRITE.state !== 'walk' || SPRITE.currentName !== targetAnim) {
        spriteShow(targetAnim, true, flipX);
        SPRITE.state = 'walk';
      }
    } else if (SPRITE.state === 'walk') {
      // 抬键：立即回待机
      SPRITE.state = 'idle';
      spriteShow('standing', true, false);
    }

    // 待机时偶尔随机表演（随机时长：基准 + 0~2 轮）
    if (SPRITE.state === 'idle' && now >= SPRITE.nextActionAt) {
      spritePlayOneshot(ONESHOT_NAMES[Math.floor(Math.random() * ONESHOT_NAMES.length)]);
      SPRITE.nextActionAt = now + rand(12000, 20000);
    }
  }

  // 渲染器跟随窗口尺寸：缩放时 canvas 同步 resize，避免精灵超出被裁剪
  function resizeRenderer() {
    const w = window.innerWidth, h = window.innerHeight;
    app.renderer.resize(w, h);
    for (const s of Object.values(SPRITE.sprites)) {
      s.position.set(w / 2, h - 6);
    }
  }

  return {
    init(app_, shared_) { app = app_; shared = shared_; },
    initSprite,
    update,
    playOneshot: spritePlayOneshot,
    backToIdle: spriteBackToIdle,
    applyPetScale,
    resizeRenderer,
    get state() { return SPRITE.state; },
  };
})();
