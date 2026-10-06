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
    petScale: 0.5,  // 初始即最小尺寸（窗口 220x265）
    maxScale: 3,    // 最大缩放（由主进程按屏幕工作区计算）
  };
  window.pet.getMaxScale().then((m) => { shared.maxScale = m; });
  // 主进程回传实际缩放值 + 目标窗口尺寸：立即用目标尺寸对齐 canvas 与精灵，
  // 避免窗口已变、画布还停在旧尺寸造成的闪烁/裁剪（同尺寸时 resizeRenderer 内部去重）
  window.pet.onScaleApplied((info) => {
    shared.petScale = info.scale;
    window.SpriteCore.resizeRenderer(info.width, info.height);
    window.SpriteCore.applyPetScale(info.width, info.height);
    window.VoiceUI.updatePosition(info.scale); // 输入框跟随桌宠脚底（固定间隙）
  });
  // 主进程缩放窗口后主动通知：canvas 立即跟随窗口尺寸（Electron frameless 的 resize 事件不可靠）
  window.pet.onPetWindowResized(({ width, height }) => {
    window.SpriteCore.resizeRenderer(width, height);
    window.SpriteCore.applyPetScale(width, height);
    window.VoiceUI.updatePosition(shared.petScale);
    // 验证用：对比通知尺寸与实际 canvas 尺寸（仅 PET_DEBUG 输出）
    const cv = document.querySelector('#stage canvas');
    window.pet.debugLog(`[canvas] notify=${width}x${height} css=${cv?.style.width}x${cv?.style.height} attr=${cv?.width}x${cv?.height}`);
  });
  window.pet.onMousePos((p) => { shared.lastMouse = p; });

  // ---------- 装配模块 ----------
  window.SpriteCore.init(app, shared);
  window.Controls.init(shared, window.SpriteCore);
  window.VoiceUI.init();
  window.VoiceUI.updatePosition(shared.petScale); // 初始定位（0.5 倍）

  // 窗口 resize（缩放桌宠）时：canvas 跟随 + 精灵 scale/位置同步，避免裁剪/闪烁
  window.addEventListener('resize', () => {
    window.SpriteCore.resizeRenderer();
    window.SpriteCore.applyPetScale();
  });

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
