const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onMousePos: (cb) => ipcRenderer.on('mouse-pos', (_e, p) => cb(p)),
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (_e, a) => cb(a)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', { dx, dy }),
  focusWindow: () => ipcRenderer.send('focus-window'),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
  setScale: (scale) => ipcRenderer.send('pet-scale', scale),
  onScaleApplied: (cb) => ipcRenderer.on('pet-scale-applied', (_e, info) => cb(info)),
  // 渲染层画布/精灵已按目标尺寸就绪，通知主进程可以改窗口（两阶段缩放，消除闪烁）
  scaleReady: () => ipcRenderer.send('pet-scale-ready'),
  // 主进程缩放窗口后主动通知渲染层（canvas 跟随窗口尺寸，不依赖浏览器 resize 事件）
  onPetWindowResized: (cb) => ipcRenderer.on('pet-window-resized', (_e, size) => cb(size)),
  getMaxScale: () => ipcRenderer.invoke('pet-get-max-scale'),
  showMenu: () => ipcRenderer.send('show-context-menu'),
  debugShot: (name) => ipcRenderer.send('debug-shot', name),
  debugLog: (msg) => ipcRenderer.send('debug-log', msg),
  quit: () => ipcRenderer.send('quit'),
  // 语音（说句话…）
  speakText: (text) => ipcRenderer.send('speak-text', text),
  onSpeakAudio: (cb) => ipcRenderer.on('play-audio', (_e, p) => cb(p)),
  onSpeakState: (cb) => ipcRenderer.on('speak-state', (_e, s) => cb(s)),
});
