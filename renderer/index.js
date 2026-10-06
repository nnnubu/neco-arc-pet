/* Neco Arc 桌宠 - 渲染进程入口
 * 职责：创建 PIXI 应用、初始化共享状态、装配各功能模块、启动主循环
 * 模块划分：
 *   sprite.js    精灵动画核心（加载/播放/循环规则/缩放适配）
 *   controls.js  交互控制（拖拽/滚轮缩放/右键菜单/键盘移动）
 *   voice-ui.js  语音输入条（说句话…）
 *   debug.js     调试序列（PET_DEBUG=1 时自动抽帧验证）
 */
(async () => {
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

  // ---------- 共享状态（各模块读写） ----------
  const shared = {
    keys: { up: false, down: false, left: false, right: false, shift: false },
    lastMouse: { mx: 0, my: 0, wx: 0, wy: 0 },
    petScale: 1,   // 当前缩放（主进程回传实际值）
    maxScale: 3,   // 最大缩放（由主进程按屏幕工作区计算）
  };
  window.pet.getMaxScale().then((m) => { shared.maxScale = m; });
  window.pet.onScaleApplied((s) => { shared.petScale = s; });
  window.pet.onMousePos((p) => { shared.lastMouse = p; });

  // ---------- 装配模块 ----------
  window.SpriteCore.init(app, shared);
  window.Controls.init(shared, window.SpriteCore);
  window.VoiceUI.init();

  // 窗口 resize（缩放桌宠）时渲染器跟随，避免精灵被裁剪
  window.addEventListener('resize', () => window.SpriteCore.resizeRenderer());

  // ---------- 加载精灵并启动主循环 ----------
  await window.SpriteCore.initSprite();
  app.ticker.add(() => {
    window.SpriteCore.update(Date.now(), app.ticker.deltaMS / 1000);
  });

  // ---------- 调试序列（PET_DEBUG=1） ----------
  const debug = new URLSearchParams(location.search).get('debug');
  if (debug === '1') window.DebugSeq.run(window.SpriteCore, shared);
})().catch((err) => {
  console.error('桌宠启动失败:', err);
});
