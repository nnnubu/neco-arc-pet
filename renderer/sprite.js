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
    groups: ['standing', 'standing_left', 'walking_left', 'walking_right', 'running', 'backflip', 'kick', 'thinking', 'wine', 'wine_2',
      'smug', 'tongue', 'push', 'star', 'pose1', 'hide', 'pout', 'lie', 'turn_left', 'turn_right'],
    frameCount: { standing: 9, standing_left: 9, walking_left: 12, walking_right: 11, running: 11, backflip: 9, kick: 7, thinking: 50, wine: 28, wine_2: 17,
      smug: 5, tongue: 60, push: 10, star: 3, pose1: 3, hide: 3, pout: 8, lie: 8, turn_left: 11, turn_right: 10 },
    FPS: 12,
    // 个别动作按更低帧率播放（预留）
    ACTION_FPS: {},
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
  // 需重复播放多遍的动作：act_84 飞行 4 帧×12=4秒（循环次数已减半，原 24 轮 8 秒）；act_60 原地重复 2 帧×24=4秒；
  // act_77/83/85 各 2 帧×18=3 秒（用户要求约 3 秒）；其余按 3 遍或 1 遍
  const ACTION_REPEATS = { thinking: 3, push: 3, star: 3, pose1: 3, hide: 3, lie: 3,
    act_84: 12, act_60: 24, act_77: 18, act_83: 18, act_85: 18 };
  // 重复播放动作每遍之间的小停顿（ms，让循环不那么急促，但不要太明显）
  const ACTION_PAUSE_MS = { act_77: 80, act_85: 80 };
  // 个别动作补偿系数微调：hide 帧偏移 -8/-13/-13.5，1.6× 下帧3仍偏右0.7px，1.75× 使帧2/3微偏左（不偏右）
  const FLIP_OFFSET_K = { hide: 1.75 };
  // 朝左翻转播放时的角色中心补偿（px，动作帧角色不居中：正=原始帧角色偏右）
  // 翻转后视觉重心移动 2×offset，播放时 position.x 反向补偿，使朝左/朝右角色视觉同位置
  const FLIP_OFFSET = {
    tongue: -35.5,
    push: -22.5,
    backflip: -19.5,
    walking_left: -13.5,
    wine_2: -12.5,
    pout: -12.0,
    wine: -11.5,
    standing_left: -11.5,
    walking_right: -11.5,
    smug: -11.0,
    star: -10.5,
    standing: -10.5,
    running: -10.0,
    turn_left: -9.5,
    turn_right: -8.5,
    pose1: -8.0,
    hide: -8.0,
    kick: -7.5,
    lie: -5.5,
    act_64: -1.5,
    act_8: -1.0,
    act_10: -1.0,
    act_11: -1.0,
    act_14: -1.0,
    act_29: -1.0,
    act_30: -1.0,
    act_31: -1.0,
    act_33: -1.0,
    act_38: -1.0,
    act_40: -1.0,
    act_41: -1.0,
    act_42: -1.0,
    act_45: -1.0,
    act_47: -1.0,
    act_56: -1.0,
    act_59: -1.0,
    act_63: -1.0,
    act_66: -1.0,
    act_68: -1.0,
    act_69: -1.0,
    act_71: -1.0,
    act_74: -1.0,
    act_75: -1.0,
    act_76: -1.0,
    act_81: -1.0,
    act_82: -1.0,
    act_83: -1.0,
    act_84: -1.0,
    act_86: -1.0,
    act_96: -1.0,
    act_99: -1.0,
  };
  // 特殊大动作（48/49/43/91）：主窗口播放时临时放大窗口到原始帧尺寸×1.05（原始帧清晰，无需独立窗口）
  // act_24：同样用原始帧完整播放（保留 41 帧动画内容），但尺寸正常、不放大窗口（enlarge=false）
  const BIG_ACTIONS = { act_48: true, act_49: true, act_43: true, act_24: true, act_91: true };
  // BIG 大动作的画面水平/垂直偏移（px）：帧内主体不在中心时，播放时移动精灵让主体对齐原桌宠位置（窗口底部中心）
  // act_91：画面双角色（猫耳主体在左、Saber 在右），右移 271px 使猫耳主体居中（Saber 仍在窗口内）
  // act_48：右移12px + 上移35px（offsetY 负=上移），对齐桌宠位置
  // act_49：全部帧已重排居中（火箭全程在画布中心，不再闪现到左侧），offsetX 归零
  // act_43：帧1剪影猫尾巴最左端x=3，右移246px使"左侧小尾巴"从桌宠位置出现
  const BIG_OFFSET_X = { act_91: 271, act_48: 12, act_49: 0, act_43: 246 };
  const BIG_OFFSET_Y = { act_48: -35 };
  // 播完保持最后一帧 2 秒再回待机的动作（smug/wine 固定 + act_65/96/97/111）
  const SMUG_HOLD_MS = 2000;
  const SMUG_HOLD_ACTIONS = ['smug', 'wine', 'act_65', 'act_96', 'act_97', 'act_111'];
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

  // oneshot 动作附带位移（沿当前朝向水平移动桌宠）：
  // - wine：前段走动（帧 1~14：行走/弯腰/抬手），播放到拿起酒杯（帧 15）后停下
  // - lie：躺倒动作全程移动，直到动作结束回待机
  // - act_84：飞行动作一播放就向上平移（全程）
  // - act_49：火箭点火（底部喷火，帧 18 起）之后向上平移，全程到动作结束
  // - act_18/29/38：奔跑冲刺，全程沿朝向水平移动
  // - act_47：全程沿朝向水平移动（脚步-位移同步尚未做，优先级低，先保留简单位移）
  // - act_53：全程反向（与朝向相反）水平移动；act_60：只重复播放、无位移
  const MOVE_ACTIONS = {
    wine: { untilFrame: 14, speed: 260 }, // AnimatedSprite currentFrame 0-based：0~13 移动
    lie: { untilEnd: true, speed: 200 },
    act_84: { untilEnd: true, speed: 300, dir: 'up' },
    act_49: { fromFrame: 18, untilEnd: true, speed: 160, dir: 'up' },
    act_18: { untilEnd: true, speed: 300 },
    act_29: { untilEnd: true, speed: 300 },
    act_38: { untilEnd: true, speed: 300 },
    act_47: { untilEnd: true, speed: 260 },
    act_53: { untilEnd: true, speed: 280, reverse: true },
    // act_19/25/30/60：屏幕上方出屏太久自动掉回底部（主进程 pet-fall-back 随机选一个触发），向下掉落全程
    // act_25 帧1-4 站立准备、帧5-7 下落（最后3张循环，fromFrame=4 起移动）；act_30 帧1-5 准备、帧6-93 下落（fromFrame=5 起移动，下落段循环）
    act_19: { untilEnd: true, speed: 500, dir: 'down' },
    act_25: { fromFrame: 4, untilEnd: true, speed: 500, dir: 'down' },
    act_30: { fromFrame: 5, untilEnd: true, speed: 500, dir: 'down' },
    act_60: { untilEnd: true, speed: 500, dir: 'down' },
  };

  // 掉回下落动作中"下落段循环"的起点帧（0-based）：25/30 开头几帧是站立准备，播完跳回下落段起点循环，
  // 直到落到底部（pet-fall-done）才结束——而不是播完就回待机
  const FALL_LOOP_FROM = { act_25: 4, act_30: 5 };
  // 掉回时随机选用的下落动作池
  const FALL_ACTIONS = ['act_19', 'act_25', 'act_30', 'act_60'];

  // 随机乱跑状态（待机时偶尔自己走动/乱跑）：null 或 { dir, remaining, run }
  let roam = null;

  // 钻地联动（33 挖地 → 隐藏 → 随机位置 → 34/72 钻出）：
  // burrowTimer 为钻出延迟定时器；state='burrow' 表示 arc 已钻地隐藏、等待随机位置钻出
  let burrowTimer = null;
  // act_33 播完：arc 挖地消失 → 窗口整体透明（消除随机位置的白点/渲染残留）→
  // 移到屏幕随机位置 → 随机 2~5 秒后恢复可见并随机选 34/72 钻出
  function startBurrowExit() {
    if (SPRITE.current) SPRITE.current.visible = false; // arc 钻地消失
    SPRITE.state = 'burrow';
    if (window.pet.setOpacity) window.pet.setOpacity(0); // 窗口全透明：钻出位置完全不可见
    if (window.pet.teleportRandom) window.pet.teleportRandom(); // 窗口移到屏幕内随机位置（透明移动不可见）
    const delay = 2000 + Math.random() * 3000; // 2~5 秒随机延迟
    if (burrowTimer) clearTimeout(burrowTimer);
    burrowTimer = setTimeout(() => {
      burrowTimer = null;
      if (SPRITE.state !== 'burrow') return; // 期间被按键/其他动作打断则取消钻出
      if (window.pet.setOpacity) window.pet.setOpacity(1); // 恢复窗口可见
      const pick = Math.random() < 0.5 ? 'act_34' : 'act_72'; // 随机从地里钻出
      spritePlayOneshot(pick);
    }, delay);
  }
  // 取消钻出（用户按键走动/切动作时）：恢复显示与窗口透明度，放弃随机钻出
  function cancelBurrow() {
    if (burrowTimer) { clearTimeout(burrowTimer); burrowTimer = null; }
    if (SPRITE.current) SPRITE.current.visible = true;
    if (window.pet.setOpacity) window.pet.setOpacity(1);
  }

  // 动态动作注册表映射（name → {name, frames}），48/49 独立窗口播放取帧数用
  let dynamicActionsMap = {};

  let app = null;
  let shared = null; // { keys, petScale, maxScale }
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // 特殊大动作（48/49）主窗口播放状态：bigSprite=原始帧精灵；bigSaved=播放前窗口/缩放
  let bigSprite = null; // { w, h, scale }
  let bigSaved = null;

  // 播放特殊大动作：加载原始分辨率帧（big_actions/），窗口临时放大到帧尺寸×1.05（底部保持），
  // 精灵 1:1 显示（原始像素清晰）；播完停留 0.4 秒后回待机并恢复窗口/缩放
  // opts.enlarge=false：不放大窗口（act_24 等正常尺寸动作），原始帧等比缩放到标准角色高度 160 显示
  async function playBigInMain(name, opts = {}) {
    if (bigSprite) { app.stage.removeChild(bigSprite); bigSprite.destroy({ children: true }); bigSprite = null; }
    if (bigSaved) restoreBig();
    SPRITE.state = 'oneshot'; // 立即锁定状态，防止加载帧期间待机随机动作/乱跑启动
    roam = null;
    const dyn = dynamicActionsMap[name];
    if (!dyn) { spriteBackToIdle(); return; }
    const texs = [];
    for (let i = 1; i <= dyn.frames; i++) {
      texs.push(await PIXI.Assets.load(`../assets/sprite/big_actions/${name}/${i}.png`));
    }
    const s = new PIXI.AnimatedSprite(texs);
    s.anchor.set(0.5, 1);
    s.animationSpeed = (opts.fps || SPRITE.FPS) / 60;
    for (const t of texs) t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    app.stage.addChild(s);
    bigSprite = s;
    // 隐藏普通精灵（standing 等），避免窗口放大后"两个桌宠"同时显示
    for (const sp of Object.values(SPRITE.sprites)) sp.visible = false;
    if (opts.enlarge === false) {
      // 不放大窗口：原始帧等比缩放到标准角色高度 160 显示（底部中心对齐当前窗口），播完直接回待机
      const k = 160 / texs[0].height;
      const sc = SPRITE.SCALE * shared.petScale * k;
      s.scale.set(sc, sc);
      s.onComplete = () => {
        if (bigSprite !== s) return;
        if (SPRITE.oneshotLeft > 1) { SPRITE.oneshotLeft--; s.gotoAndPlay(0); }
        else spriteBackToIdle();
      };
      s.loop = false;
      s.position.set(window.innerWidth / 2, window.innerHeight - 5);
      SPRITE.current = s; // 供 update 的 MOVE_ACTIONS 位移判断
      SPRITE.currentName = name;
      SPRITE.oneshotLeft = 1;
      s.gotoAndPlay(0);
      return;
    }
    s.onComplete = () => {
      if (bigSprite !== s) return;
      setTimeout(() => { if (bigSprite === s) spriteBackToIdle(); }, 400);
    };
    s.loop = false;
    s.scale.set(1.05, 1.05);
    // 先清空当前 canvas（隐藏 bigSprite 渲染一帧空画面），避免窗口放大瞬间旧待机帧残留（残影）
    s.visible = false;
    app.renderer.render(app.stage);
    // 窗口放大到帧尺寸×1.05（底部保持不跳动，48 原地播放），精灵底部中心对齐新窗口
    // offsetX：水平偏移（px，正=精灵右移），供画面主体不在帧中心的大动作（如 91 猫耳主体在左）播放时主体对齐原桌宠位置；
    // 有偏移时窗口左右各加宽 |offsetX|（负偏移同样加宽），保证偏移后整个画面不被裁剪
    // offsetY：垂直偏移（px，负=上移）
    const w = Math.round(texs[0].width * 1.05 + Math.abs(opts.offsetX || 0) * 2);
    const h = Math.round(texs[0].height * 1.05);
    bigSaved = { w: window.innerWidth, h: window.innerHeight, scale: shared.petScale };
    window.pet.resizeWindow(w, h, true);
    // 等窗口 resize 完成（canvas 已跟随新尺寸）后再定位/播放，避免 canvas 与窗口错位导致偏移
    setTimeout(() => {
      if (bigSprite !== s) return;
      // 强制 canvas 同步窗口尺寸（不等 resize 事件，防止 canvas 仍是旧尺寸导致定位错位），再清空一次防残留
      if (app.renderer.width !== w || app.renderer.height !== h) app.renderer.resize(w, h);
      app.renderer.render(app.stage);
      s.visible = true;
      s.position.set(w / 2 + (opts.offsetX || 0), h - 5 + (opts.offsetY || 0));
      SPRITE.state = 'oneshot';
      SPRITE.current = s; // 供 update 的 MOVE_ACTIONS 位移（49 点火后上移）判断
      SPRITE.currentName = name;
      SPRITE.oneshotLeft = 1;
      s.gotoAndPlay(0);
    }, 50);
  }

  function restoreBig() {
    if (!bigSaved) return;
    if (bigSprite) {
      if (SPRITE.current === bigSprite) { SPRITE.current = null; SPRITE.currentName = ''; }
      app.stage.removeChild(bigSprite);
      bigSprite.destroy({ children: true });
      bigSprite = null;
    }
    window.pet.resizeWindow(bigSaved.w, bigSaved.h, true);
    shared.petScale = bigSaved.scale;
    bigSaved = null;
    applyPetScale();
  }

  function spriteShow(name, loop, flipX) {
    const s = SPRITE.sprites[name];
    if (!s) return;
    if (SPRITE.current && SPRITE.current !== s) SPRITE.current.visible = false;
    SPRITE.current = s;
    SPRITE.currentName = name;
    s.visible = true;
    const sc = SPRITE.SCALE * shared.petScale;
    s.scale.set(flipX ? -sc : sc, sc);
    // 翻转播放时补偿角色视觉中心：动作帧角色不居中（FLIP_OFFSET），翻转后视觉重心偏移，
    // 补偿 offset×系数（默认1×，hide 用 1.35×）使朝左播放角色整体居中（2× 全补偿会让波动大的动作偏左/裁剪）
    s.position.set(window.innerWidth / 2 + (flipX ? (FLIP_OFFSET[name] || 0) * (FLIP_OFFSET_K[name] || 1) * sc : 0), window.innerHeight - 5); // 底部对齐（-5 避免 0.5 倍时头部裁 1px）
    s.loop = loop;
    s.animationSpeed = (SPRITE.ACTION_FPS[name] || SPRITE.FPS) / 60; // 覆盖创建时的默认帧率（高帧率原图动作）
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

  function spritePlayOneshot(name, opts) {
    // 走动优先，不打断；但掉回模式（fallback）例外——出屏掉回必须强制播放掉落动画
    if (SPRITE.state === 'walk' && !(opts && opts.fallback)) return;
    // 钻地隐藏等待中：用户切到其他动作时取消钻出（重新显示 arc，放弃随机钻出）
    if (SPRITE.state === 'burrow') {
      if (burrowTimer) { clearTimeout(burrowTimer); burrowTimer = null; }
      if (SPRITE.current) SPRITE.current.visible = true;
      if (window.pet.setOpacity) window.pet.setOpacity(1); // 恢复窗口透明度
    }
    roam = null; // 播放动作时立即停止随机乱跑（否则乱跑分支优先，窗口继续移动导致位置偏移）
    // 常驻趴着形态（23）：循环播放不自动回待机，直到用户切其他动作/重置——作为可停留的趴卧姿态
    if (name === 'act_23') {
      spriteShow(name, true, SPRITE.facing === -1);
      SPRITE.state = 'oneshot';
      SPRITE.oneshotLeft = 0; // 循环播放，onComplete 不再触发
      return;
    }
    // act_24：原始帧完整播放（big_actions/），正常尺寸不放大窗口，20fps 播放（24fps 仍偏快、12fps 慢放显形位移）
    if (name === 'act_24') { playBigInMain(name, { enlarge: false, fps: 20 }); return; }
  // 特殊大动作（48/49/43）：主窗口临时放大播放原始帧（不裁剪、不模糊）
    if (BIG_ACTIONS[name]) {
      playBigInMain(name, { offsetX: BIG_OFFSET_X[name] || 0, offsetY: BIG_OFFSET_Y[name] || 0 });
      return;
    }
    SPRITE.oneshotLeft = ACTION_REPEATS[name] || 1;
    // 动作跟随站立朝向：朝左时水平翻转（像素动作本身是朝右的）
    spriteShow(name, false, SPRITE.facing === -1);
    SPRITE.state = 'oneshot';
    // 掉回模式（opts.fallback）：act_19 向下位移由主进程驱动窗口，渲染层不叠加位移
    // （避免双倍下落速度 + 两个循环同时 setPosition 的位置竞争/抖动）
    SPRITE.noMove = !!(opts && opts.fallback);
  }

  // 菜单手动播放转向动画：转向动画内容自带方向（turn_left=左→右、turn_right=右→左），
  // 不按当前朝向翻转（避免朝左时播 turn_left 被翻转成反向）；播完 onComplete 自动更新朝向
  function playTurn(name) {
    if (SPRITE.state === 'walk') return;
    roam = null;
    SPRITE.oneshotLeft = 1;
    spriteShow(name, false, false);
    SPRITE.state = 'oneshot';
  }

  function spriteBackToIdle() {
    if (SPRITE.state === 'walk') return; // 走动中不打断
    if (bigSaved) restoreBig(); // 48/49 特殊大动作播完：恢复原窗口/缩放
    SPRITE.state = 'idle';
    showStanding();
  }

  // 站立：朝右用 standing（不翻转），朝左用 standing_left（预镜像帧）——
  // 避免水平翻转 standing 导致站位左右偏移（朝左时角色中心会跳到偏右 11px，转向衔接跳变）
  function showStanding() {
    spriteShow(SPRITE.facing === -1 ? 'standing_left' : 'standing', true, false);
  }

  // 转身：站立朝向改变时播放转身过渡动画（turn_left 内容=左→右 / turn_right 内容=右→左，
  // 与文件名相反——帧内容实测：turn_left 起点朝左终点朝右，turn_right 起点朝右终点朝左），
  // 播完更新朝向（转向动画终点方向与 standing 一致，不再出现"转完突然又面向反方向"）
  function turnTo(targetFacing) {
    if (SPRITE.facing === targetFacing) return;
    if (SPRITE.state === 'walk') return; // 走动中不转身（走路帧自带方向）
    if (SPRITE.state === 'oneshot') return; // 动作表演中不打断
    SPRITE.oneshotLeft = 1;
    // 目标朝左 → 播 turn_right（内容右→左）；目标朝右 → 播 turn_left（内容左→右）
    spriteShow(targetFacing === -1 ? 'turn_right' : 'turn_left', false, false);
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
        else if (SMUG_HOLD_ACTIONS.includes(SPRITE.currentName)) {
          const cur = s;
          setTimeout(() => {
            if (SPRITE.current === cur && SPRITE.state === 'oneshot') spriteBackToIdle();
          }, SMUG_HOLD_MS);
        } else if (SPRITE.currentName === 'turn_left' || SPRITE.currentName === 'turn_right') {
          // 转身动画播完：更新站立朝向（turn_left 内容转到右 → facing=1；turn_right 内容转到左 → facing=-1）
          SPRITE.facing = SPRITE.currentName === 'turn_left' ? 1 : -1;
          spriteBackToIdle();
        } else {          spriteBackToIdle();
        }
      };
      app.stage.addChild(s);
      SPRITE.sprites[g] = s;
    }
    // 迁移动作（act_*）：从 main 读取注册表动态加载帧组，播放一遍回待机（无重复/停留/位移）
    try {
      const dyn = await window.pet.getActions();
      dynamicActionsMap = {};
      for (const a of dyn || []) {
        dynamicActionsMap[a.name] = a;
        // 特殊大动作（48/49/43）的帧在 big_actions/ 原始分辨率目录，这里不加载 animations/ 帧
        // （该目录不存在，加载会抛错中断后续所有动态动作注册）
        if (BIG_ACTIONS[a.name]) continue;
        const texs = [];
        for (let i = 1; i <= a.frames; i++) {
          texs.push(await PIXI.Assets.load(`../assets/sprite/animations/${a.name}/${i}.png`));
        }
        const s = new PIXI.AnimatedSprite(texs);
        s.anchor.set(0.5, 1);
        s.animationSpeed = SPRITE.FPS / 60;
        s.visible = false;
        for (const t of texs) t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        s.onComplete = () => {
          if (SPRITE.state !== 'oneshot' || SPRITE.current !== s) return;
          // act_33 挖地钻入：播完 arc 消失，随机延迟后从屏幕随机位置钻出（34/72 二选一）
          if (SPRITE.currentName === 'act_33') { startBurrowExit(); return; }
          // 25/30 下落段循环：播到末尾跳回下落段起点（开头站立准备帧只播一遍），持续循环直到落底结束
          const loopFrom = FALL_LOOP_FROM[SPRITE.currentName];
          if (loopFrom !== undefined) { s.gotoAndPlay(loopFrom); return; }
          // 按轮数循环（act_84 等需重复播放的动作）；77/85 每遍间加小停顿；Smug 式动作（65/96/97/111）播完保持最后一帧 2 秒；其余回待机
          if (SPRITE.oneshotLeft > 1) {
            SPRITE.oneshotLeft--;
            if (ACTION_PAUSE_MS[SPRITE.currentName]) {
              setTimeout(() => { if (SPRITE.current === s && SPRITE.state === 'oneshot') s.gotoAndPlay(0); }, ACTION_PAUSE_MS[SPRITE.currentName]);
            } else s.gotoAndPlay(0);
          }
          else if (SMUG_HOLD_ACTIONS.includes(SPRITE.currentName)) {
            const cur = s;
            setTimeout(() => {
              if (SPRITE.current === cur && SPRITE.state === 'oneshot') spriteBackToIdle();
            }, SMUG_HOLD_MS);
          } else spriteBackToIdle();
        };
        app.stage.addChild(s);
        SPRITE.sprites[a.name] = s;
      }
      // 后台预加载 48/49/43/24/91 原始帧（big_actions/），首次播放时立即就绪，避免加载延迟导致的异常帧
      for (const bn of ['act_48', 'act_49', 'act_43', 'act_24', 'act_91']) {
        const ba = dynamicActionsMap[bn];
        if (!ba) continue;
        for (let i = 1; i <= ba.frames; i++) {
          PIXI.Assets.load(`../assets/sprite/big_actions/${bn}/${i}.png`).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[sprite] 动态动作加载失败:', e);
    }
    SPRITE.state = 'idle';
    SPRITE.nextActionAt = Date.now() + rand(8000, 15000);
    SPRITE.nextRoamAt = Date.now() + rand(15000, 30000); // 首次随机乱跑计时
    showStanding();
    window.pet.resizeWindow(220, 265); // 初始窗口 = 最小尺寸
    // 屏幕上方停留太久（主进程检测 pet-fall-back）：播放 act_19 向下掉落回屏幕底部
    // （火箭等大动作飞出去后桌宠停在屏幕顶部，键盘难以操控，自动掉回可恢复）
    window.pet.onFallBack(() => {
      // 钻地隐藏等待中/已在掉落中/正在播放大动作（48/49/43/24/91）时忽略，避免打断；
      // 走动中也强制播放（用户按着 W 走出屏时也必须掉回，不能保持走路姿势下落）
      if (SPRITE.state === 'burrow' || FALL_ACTIONS.includes(SPRITE.currentName) || (SPRITE.state === 'oneshot' && bigSprite)) return;
      // fallback 模式：下落动作只播动画，向下位移由主进程统一驱动（避免双倍下落/位置竞争）
      // 随机选用一个下落动作（19 全程掉落 / 25、30 准备后掉落 / 60 重复掉落）
      const pick = FALL_ACTIONS[Math.floor(Math.random() * FALL_ACTIONS.length)];
      spritePlayOneshot(pick, { fallback: true });
    });
    // 主进程下落已抵达底部：立即结束下落动作回待机（避免动画落地后继续空播几秒）
    window.pet.onFallDone(() => {
      if (SPRITE.state === 'oneshot' && FALL_ACTIONS.includes(SPRITE.currentName)) spriteBackToIdle();
    });
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
      // 钻地隐藏等待中按键：取消钻出（重新显示 arc 正常走动）
      if (SPRITE.state === 'burrow') cancelBurrow();
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
        showStanding();
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
      showStanding();
    } else if (SPRITE.state === 'oneshot' && SPRITE.current) {
      // 一次性动作附带位移：wine 走动段（拿起酒杯前）/ lie 全程——沿当前朝向移动桌宠；
      // act_84 全程向上；act_49 点火（帧18）后向上——dir:'up' 时垂直移动（窗口上移）
      const mv = MOVE_ACTIONS[SPRITE.currentName];
      if (mv) {
        let moving = mv.untilEnd || SPRITE.current.currentFrame < mv.untilFrame;
        if (mv.fromFrame !== undefined && SPRITE.current.currentFrame < mv.fromFrame) moving = false;
        if (moving && !SPRITE.noMove) { // 掉回模式（noMove）：位移由主进程驱动，渲染层不叠加
          const dirSign = mv.reverse ? -1 : 1; // reverse：位移方向与朝向相反
          if (mv.dir === 'up') window.pet.moveBy(0, -Math.round(mv.speed * dt));
          else if (mv.dir === 'down') window.pet.moveBy(0, Math.round(mv.speed * dt)); // 向下掉落（act_19 掉回屏幕底部）
          else if (mv.dir === 'diag-up') window.pet.moveBy(Math.round(dirSign * SPRITE.facing * mv.speed * dt), -Math.round(mv.speed * dt)); // 斜向上：水平沿朝向 + 垂直向上
          else window.pet.moveBy(Math.round(dirSign * SPRITE.facing * mv.speed * dt), 0);
        }
      }
      // 43/48 播完前淡出：最后约 25% 帧数内透明度逐渐降到 0，柔和过渡到回待机（中间帧的虚化衔接）
      if (bigSprite && (SPRITE.currentName === 'act_43' || SPRITE.currentName === 'act_48') && bigSprite.alpha > 0) {
        const s = bigSprite;
        const fadeFrames = Math.max(4, Math.round(s.totalFrames * 0.25));
        const remain = s.totalFrames - s.currentFrame;
        if (remain <= fadeFrames) {
          // 按时间均匀淡出（update 约 60fps，动画 12fps：fadeFrames 动画帧对应 fadeFrames/12 秒）
          const step = 1 / (fadeFrames / SPRITE.FPS * 60);
          s.alpha = Math.max(0, s.alpha - step);
        }
      }
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
    playTurn,
    backToIdle: spriteBackToIdle,
    turnTo,
    setNoRandom(v) { SPRITE.noRandom = v; },
    applyPetScale,
    resizeRenderer,
    get state() { return SPRITE.state; },
    get facing() { return SPRITE.facing; },
  };
})();
