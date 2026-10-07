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
  // 主进程缩放动画每步通知渲染层（画布跟随窗口尺寸、精灵按 scale 反推，窗口与画面始终同步）
  onPetWindowResized: (cb) => ipcRenderer.on('pet-window-resized', (_e, size) => cb(size)),
  getMaxScale: () => ipcRenderer.invoke('pet-get-max-scale'),
  showMenu: () => ipcRenderer.send('show-context-menu'),
  getActions: () => ipcRenderer.invoke('get-actions'),
  debugShot: (name) => ipcRenderer.send('debug-shot', name),
  debugLog: (msg) => ipcRenderer.send('debug-log', msg),
  quit: () => ipcRenderer.send('quit'),
  // 语音（说句话…）
  speakText: (text, force) => ipcRenderer.send('speak-text', text, !!force),
  onSpeakAudio: (cb) => ipcRenderer.on('play-audio', (_e, p) => cb(p)),
  onSpeakState: (cb) => ipcRenderer.on('speak-state', (_e, s) => cb(s)),
  onAiReply: (cb) => ipcRenderer.on('ai-reply', (_e, r) => cb(r)),
  onAiToken: (cb) => ipcRenderer.on('ai-token', (_e, r) => cb(r)),
  // 唱歌（翻唱）
  singSong: (songPath) => ipcRenderer.send('sing-song', songPath),
  onSingProgress: (cb) => ipcRenderer.on('sing-progress', (_e, s) => cb(s)),
  onSingDone: (cb) => ipcRenderer.on('sing-done', (_e, r) => cb(r)),
  onSingError: (cb) => ipcRenderer.on('sing-error', (_e, e) => cb(e)),
});
