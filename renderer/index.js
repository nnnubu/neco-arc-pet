/* Neco Arc 桌宠 - 像素精灵图模式（纯像素版，已移除 Live2D） */
(async () => {
  // ---------- 工具 ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // ---------- PIXI 应用 ----------
  const app = new PIXI.Application({
    width: 440,
    height: 530,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: 1,
  });
  document.getElementById('stage').appendChild(app.view);
  PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST; // 像素风采样

  // ---------- 共享交互状态 ----------
  let lastMouse = { mx: 0, my: 0, wx: 0, wy: 0 };
  const keys = { up: false, down: false, left: false, right: false, shift: false };
  const KEY_MAP = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
  };
  let downAt = null, downPos = null, dragging = false;
  const DRAG_THRESHOLD = 6;
  // 桌宠缩放：滚轮悬停缩放，范围 0.5x ~ 最大(窗口不超屏幕)
  let petScale = 1;
  const SCALE_MIN = 0.5;
  const SCALE_STEP = 0.1;
  let SCALE_MAX = 3;
  window.pet.getMaxScale().then((m) => { SCALE_MAX = m; });
  window.pet.onScaleApplied((s) => { petScale = s; });
  window.pet.onMousePos((p) => { lastMouse = p; });

  // ==================== 精灵图核心 ====================
  const SPRITE = {
    groups: ['standing', 'walking_left', 'walking_right', 'running', 'backflip', 'kick', 'thinking', 'wine', 'wine_2',
      'smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie'],
    frameCount: { standing: 9, walking_left: 12, walking_right: 11, running: 11, backflip: 9, kick: 7, thinking: 4, wine: 28, wine_2: 17,
      smug: 5, tongue: 60, push: 10, star: 3, pose1: 3, hide: 3, pout: 8, lie: 8 },
    FPS: 12,
    SCALE: 2,
    WIN_W: 440,
    WIN_H: 530,
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

  function spriteShow(name, loop, flipX) {
    const s = SPRITE.sprites[name];
    if (!s) return;
    if (SPRITE.current && SPRITE.current !== s) SPRITE.current.visible = false;
    SPRITE.current = s;
    SPRITE.currentName = name;
    s.visible = true;
    const sc = SPRITE.SCALE * petScale;
    s.scale.set(flipX ? -sc : sc, sc);
    s.position.set(window.innerWidth / 2, window.innerHeight - 6);
    s.loop = loop;
    s.gotoAndPlay(0);
  }

  // 应用缩放：更新所有精灵 scale 与位置（窗口 resize 后底部中心对齐）
  function applyPetScale() {
    const sc = SPRITE.SCALE * petScale;
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
    window.pet.resizeWindow(SPRITE.WIN_W, SPRITE.WIN_H);
  }

  function updateSprite(now, dt) {
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

  // ==================== 主循环 ====================
  app.ticker.add(() => {
    updateSprite(Date.now(), app.ticker.deltaMS / 1000);
  });

  // ==================== 点击 / 拖拽 ====================
  window.addEventListener('mousedown', (e) => {
    downAt = Date.now();
    downPos = { x: e.clientX, y: e.clientY };
    dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (downAt === null) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > DRAG_THRESHOLD) {
        dragging = true;
        window.pet.dragStart();
      }
    }
    if (dragging) window.pet.dragMove();
  });
  window.addEventListener('mouseup', (e) => {
    if (dragging) {
      window.pet.dragEnd();
    }
    downAt = null;
    dragging = false;
  });

  // ==================== 缩放（滚轮） ====================
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1; // 上滚放大，下滚缩小
    const ns = Math.round((petScale + dir * SCALE_STEP) * 10) / 10;
    if (ns < SCALE_MIN || ns > SCALE_MAX || ns === petScale) return;
    petScale = ns;
    applyPetScale(); // 先更新精灵（窗口 resize 后位置随 innerWidth/innerHeight 校正）
    window.pet.setScale(petScale);
  });
  // 渲染器跟随窗口尺寸：缩放时 canvas 同步 resize，避免精灵超出被裁剪
  function resizeRenderer() {
    const w = window.innerWidth, h = window.innerHeight;
    app.renderer.resize(w, h);
    for (const s of Object.values(SPRITE.sprites)) {
      s.position.set(w / 2, h - 6);
    }
  }
  // 窗口尺寸变化（缩放触发）后，canvas 与精灵底部中心跟随新窗口
  window.addEventListener('resize', resizeRenderer);

  // ==================== 右键菜单 ====================
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.pet.showMenu();
  });
  window.pet.onMenuAction((name) => {
    if (name === 'SPEAK') { showSpeakBar(); return; }
    if (name === 'RESET') { spriteBackToIdle(); return; }
    if (ONESHOT_NAMES.includes(name)) spritePlayOneshot(name);
  });

  // ==================== 语音（说句话…） ====================
  const speakBar = document.getElementById('speakBar');
  const speakInput = document.getElementById('speakInput');
  const speakSend = document.getElementById('speakSend');
  const speakClose = document.getElementById('speakClose');
  const speakStatus = document.getElementById('speakStatus');
  const petAudio = document.getElementById('petAudio');

  function showSpeakBar() {
    speakStatus.textContent = '';
    speakBar.style.display = 'block';
    speakInput.value = '';
    setTimeout(() => speakInput.focus(), 60);
  }
  function hideSpeakBar() { speakBar.style.display = 'none'; }

  window.pet.onSpeakAudio((p) => {
    petAudio.src = 'file:///' + p.replace(/\\/g, '/');
    petAudio.play().catch((e) => {
      speakStatus.textContent = '播放失败: ' + (e.message || e);
    });
  });
  window.pet.onSpeakState((s) => {
    if (s.state === 'generating') {
      speakStatus.textContent = '喵…生成中（首次需等约 1 分钟）';
    } else if (s.state === 'done') {
      speakStatus.textContent = '';
      setTimeout(hideSpeakBar, 600);
    } else if (s.state === 'error') {
      speakStatus.textContent = '出错了: ' + (s.error || '未知');
    }
  });
  speakSend.addEventListener('click', () => {
    const t = speakInput.value.trim();
    if (!t) return;
    window.pet.speakText(t);
  });
  speakClose.addEventListener('click', hideSpeakBar);
  speakInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // 输入时不影响桌宠移动
    if (e.key === 'Enter') speakSend.click();
    if (e.key === 'Escape') hideSpeakBar();
  });

  // ==================== 键盘 ====================
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') { keys.shift = true; return; }
    const k = KEY_MAP[e.key];
    if (!k) return;
    e.preventDefault();
    keys[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') { keys.shift = false; return; }
    const k = KEY_MAP[e.key];
    if (!k) return;
    keys[k] = false;
  });
  window.addEventListener('mouseenter', () => window.pet.focusWindow());

  // ==================== 启动 ====================
  await initSprite();

  // ==================== 调试序列（PET_DEBUG=1） ====================
  const debug = new URLSearchParams(location.search).get('debug');
  if (debug === '1') {
    const shot = (name) => window.pet.debugShot(name);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(2500);
    await shot('idle');

    // 走路循环衔接验证：按住右键 2 秒抽 3 帧，步态应连续变化（无跳回首帧突兀）
    window.pet.moveBy(-700, 0);
    await wait(300);
    keys.right = true;
    await wait(700);
    await shot('walk-a');
    await wait(600);
    await shot('walk-b');
    await wait(700);
    await shot('walk-c');
    keys.right = false;
    await wait(400);
    await shot('walk-stop');    // 抬键回待机

    // Shift 跑步循环验证：按住 3.5 秒抽 8 帧，循环内应只有跑姿帧（无起跑/收尾/站立帧）
    keys.right = true;
    keys.shift = true;
    await wait(500);
    await shot('run-1');
    await wait(400);
    await shot('run-2');
    await wait(400);
    await shot('run-3');
    await wait(400);
    await shot('run-4');
    await wait(400);
    await shot('run-5');
    await wait(400);
    await shot('run-6');
    await wait(400);
    await shot('run-7');
    await wait(500);
    await shot('run-8');
    keys.shift = false;
    keys.right = false;
    await wait(400);

    // 时长验证：思考基准 9 轮 ≈ 3 秒（1.5s 时仍在播，3.7s 时应回待机）
    spritePlayOneshot('thinking');
    await wait(1500);
    await shot('think-mid');
    await wait(2200);
    await shot('think-done');

    // 后空翻 4 轮 ≈ 3 秒
    spritePlayOneshot('backflip');
    await wait(1500);
    await shot('backflip-mid');
    await wait(2200);
    await shot('backflip-done');

    // 新表情动作验证：逐个播放并抽帧（确认 gif 帧序列可加载、播放正常）
    for (const a of ['smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie']) {
      spritePlayOneshot(a);
      await wait(550);
      await shot('act-' + a);
    }

    // 缩放验证：1.5 倍后抽帧确认窗口与精灵渲染正常，再恢复
    window.pet.setScale(1.5);
    await wait(800);
    window.pet.debugLog('inner after 1.5x = ' + window.innerWidth + 'x' + window.innerHeight);
    await shot('scale-15');
    window.pet.setScale(1);
    await wait(800);
    await shot('scale-10');
    console.log('[debug] sequence done');
  }
})().catch((err) => {
  console.error('桌宠启动失败:', err);
});
