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
      'smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie', 'turn_left', 'turn_right'],
    frameCount: { standing: 9, walking_left: 12, walking_right: 11, running: 11, backflip: 9, kick: 7, thinking: 4, wine: 28, wine_2: 17,
      smug: 5, tongue: 60, push: 10, star: 3, pose1: 3, hide: 3, pout: 8, lie: 8, turn_left: 11, turn_right: 10 },
    FPS: 12,
    SCALE: 2,
    sprites: {},
    current: null,
    currentName: '',
    state: 'idle', // idle | walk | oneshot
    oneshotLeft: 0, // 一次性动作剩余播放轮数
    nextActionAt: 0,
    facing: 1, // 站立朝向：1=右，-1=左（standing 翻转实现）
    lastMoveX: 0, // 最后水平移动方向（抬键后 vx 已归零，需在移动中记录）
    noRandom: false, // 调试：禁用随机乱跑/随机动作（PET_DEBUG 序列用）
  };
  // 需重复播放 3 遍的动作（thinking/push/star/pose1/hide/lie）；其余动作播放一遍即回待机
  const ACTION_REPEATS = { thinking: 3, push: 3, star: 3, pose1: 3, hide: 3, lie: 3 };
  // smug/wine 播完保持最后一帧的时长（2 秒）再回待机
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

  // 随机乱跑状态（待机时偶尔自己走动/乱跑）：null 或 { dir, remaining, run }
  let roam = null;

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
    s.position.set(window.innerWidth / 2, window.innerHeight - 5); // 底部对齐（-5 避免 0.5 倍时头部裁 1px）
    s.loop = loop;
    s.gotoAndPlay(0);
  }

  // 应用缩放：更新所有精灵 scale 与位置（窗口 resize 后底部中心对齐）
  // w/h 显式传入目标窗口尺寸；缺省读 window.innerWidth/innerHeight
  function applyPetScale(w = window.innerWidth, h = window.innerHeight) {
    const sc = SPRITE.SCALE * shared.petScale;
    for (const s of Object.values(SPRITE.sprites)) {
      const flip = s.scale.x < 0;
      s.scale.set((flip ? -1 : 1) * sc, sc);
      s.position.set(w / 2, h - 5);
    }
  }

  function spritePlayOneshot(name) {
    if (SPRITE.state === 'walk') return; // 走动优先，不打断
    SPRITE.oneshotLeft = ACTION_REPEATS[name] || 1;
    // 动作跟随站立朝向：朝左时水平翻转（像素动作本身是朝右的）
    spriteShow(name, false, SPRITE.facing === -1);
    SPRITE.state = 'oneshot';
  }

  function spriteBackToIdle() {
    if (SPRITE.state === 'walk') return; // 走动中不打断
    SPRITE.state = 'idle';
    spriteShow('standing', true, SPRITE.facing === -1);
  }

  // 转身：站立朝向改变时播放转身过渡动画（turn_left 右→左 / turn_right 左→右），播完更新朝向
  function turnTo(targetFacing) {
    if (SPRITE.facing === targetFacing) return;
    if (SPRITE.state === 'walk') return; // 走动中不转身（走路帧自带方向）
    if (SPRITE.state === 'oneshot') return; // 动作表演中不打断
    SPRITE.oneshotLeft = 1;
    spriteShow(targetFacing === -1 ? 'turn_left' : 'turn_right', false, false);
    SPRITE.state = 'oneshot';
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
      // 一次性动画：指定动作按轮数循环；smug/wine 播完保持最后一帧约 2 秒；其余播完直接回待机
      s.onComplete = () => {
        if (SPRITE.state !== 'oneshot' || SPRITE.current !== s) return;
        if (SPRITE.oneshotLeft > 1) { SPRITE.oneshotLeft--; s.gotoAndPlay(0); }
        else if (SPRITE.currentName === 'smug' || SPRITE.currentName === 'wine') {
          const cur = s;
          setTimeout(() => {
            if (SPRITE.current === cur && SPRITE.state === 'oneshot') spriteBackToIdle();
          }, SMUG_HOLD_MS);
        } else if (SPRITE.currentName === 'turn_left' || SPRITE.currentName === 'turn_right') {
          // 转身动画播完：更新站立朝向（turn_left 结束=朝左，turn_right 结束=朝右）
          SPRITE.facing = SPRITE.currentName === 'turn_left' ? -1 : 1;
          spriteBackToIdle();
        } else {
          spriteBackToIdle();
        }
      };
      app.stage.addChild(s);
      SPRITE.sprites[g] = s;
    }
    SPRITE.state = 'idle';
    SPRITE.nextActionAt = Date.now() + rand(8000, 15000);
    SPRITE.nextRoamAt = Date.now() + rand(15000, 30000); // 首次随机乱跑计时
    spriteShow('standing', true, false);
    window.pet.resizeWindow(220, 265); // 初始窗口 = 最小尺寸
  }

  // 每帧更新：走动（按键持续循环播放）、随机乱跑、待机随机动作
  function update(now, dt) {
    const keys = shared.keys;
    const vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const moving = vx !== 0 || vy !== 0;

    if (moving) {
      // 用户按键：打断随机乱跑，完全由用户控制
      roam = null;
      // 记录最后水平移动方向（抬键后 vx 归零，朝向更新要用它）
      if (vx !== 0) SPRITE.lastMoveX = vx;
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
    } else if (roam) {
      // 随机乱跑中：水平+垂直两轴各自独立方向（两轴同时非 0 即斜线移动），到达随机距离后停下
      const spd = roam.run ? 430 : 260;
      window.pet.moveBy(Math.round(roam.dirX * spd * dt), Math.round(roam.dirY * spd * dt));
      // 剩余距离按实际合成步长衰减（斜线按 √2 计，与移动量一致）
      roam.remaining -= spd * dt * (roam.dirX !== 0 && roam.dirY !== 0 ? Math.SQRT2 : 1);
      if (roam.remaining <= 0) {
        const lastDirX = roam.dirX;
        roam = null;
        if (lastDirX !== 0) SPRITE.facing = lastDirX; // 站立朝向 = 最后水平跑动方向
        SPRITE.state = 'idle';
        spriteShow('standing', true, SPRITE.facing === -1);
        // 停下来后偶尔随机转身（朝反方向站一会）
        if (Math.random() < 0.5) {
          setTimeout(() => { if (SPRITE.state === 'idle') turnTo(Math.random() < 0.5 ? 1 : -1); }, rand(400, 1500));
        }
        SPRITE.nextRoamAt = now + rand(15000, 30000);
      }
    } else if (SPRITE.state === 'walk') {
      // 抬键：立即回待机，站立朝向 = 最后移动方向（vx 已归零，用移动中记录的 lastMoveX）
      SPRITE.state = 'idle';
      if (SPRITE.lastMoveX !== 0) {
        SPRITE.facing = SPRITE.lastMoveX > 0 ? 1 : -1;
        SPRITE.lastMoveX = 0;
      }
      spriteShow('standing', true, SPRITE.facing === -1);
    }

    // 待机时偶尔自己乱跑 / 随机表演动作（互斥触发，随机时长）
    if (SPRITE.state === 'idle' && !roam && !SPRITE.noRandom) {
      if (now >= SPRITE.nextRoamAt) {
        // 触发乱跑：水平/垂直两轴各自独立随机（各为 -1/0/1，概率相同），
        // 两轴同时非 0 即斜线移动；排除两轴都 0 的原地不动
        let dirX, dirY;
        do {
          dirX = Math.floor(Math.random() * 3) - 1;
          dirY = Math.floor(Math.random() * 3) - 1;
        } while (dirX === 0 && dirY === 0);
        roam = {
          dirX, dirY,
          remaining: rand(150, 500),
          run: Math.random() < 0.4,
        };
        SPRITE.state = 'walk';
        // 纯垂直移动（dirX=0）时借用当前朝向的水平走路帧，避免动画方向跳变
        const ax = dirX !== 0 ? dirX : (SPRITE.facing >= 0 ? 1 : -1);
        spriteShow(roam.run ? 'running' : (ax > 0 ? 'walking_right' : 'walking_left'), true,
          roam.run && ax < 0);
      } else if (now >= SPRITE.nextActionAt) {
        spritePlayOneshot(ONESHOT_NAMES[Math.floor(Math.random() * ONESHOT_NAMES.length)]);
        SPRITE.nextActionAt = now + rand(12000, 20000);
      }
    }
  }

  // 渲染器跟随窗口尺寸：缩放时 canvas 同步 resize，避免精灵超出被裁剪
  // 优先使用显式传入的窗口尺寸（主进程通知），兜底读 window.innerWidth/innerHeight
  // 同尺寸去重：避免 resize 事件与主进程主动通知双重触发（PIXI resize 会清屏重绘，重复触发会闪烁）
  let lastRw = 0, lastRh = 0;
  function resizeRenderer(w = window.innerWidth, h = window.innerHeight) {
    if (w === lastRw && h === lastRh) return;
    lastRw = w; lastRh = h;
    app.renderer.resize(w, h);
  }

  return {
    init(app_, shared_) { app = app_; shared = shared_; },
    initSprite,
    update,
    playOneshot: spritePlayOneshot,
    backToIdle: spriteBackToIdle,
    turnTo,
    setNoRandom(v) { SPRITE.noRandom = v; },
    applyPetScale,
    resizeRenderer,
    get state() { return SPRITE.state; },
    get facing() { return SPRITE.facing; },
  };
})();
