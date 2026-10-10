const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onMousePos: (cb) => ipcRenderer.on('mouse-pos', (_e, p) => cb(p)),
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (_e, a) => cb(a)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', { dx, dy }),
  focusWindow: () => ipcRenderer.send('focus-window'),
  resizeWindow: (width, height, keepBottom) => ipcRenderer.send('resize-window', { width, height, keepBottom }),
  setScale: (scale) => ipcRenderer.send('pet-scale', scale),
  // 主进程缩放动画每步通知渲染层（画布跟随窗口尺寸、精灵按 scale 反推，窗口与画面始终同步）
  onPetWindowResized: (cb) => ipcRenderer.on('pet-window-resized', (_e, size) => cb(size)),
  // 屏幕上方出屏太久：主进程检测到后通知渲染层播放 act_19 掉回屏幕底部
  onFallBack: (cb) => ipcRenderer.on('pet-fall-back', () => cb()),
  onFallDone: (cb) => ipcRenderer.on('pet-fall-done', () => cb()),
  // 入场动画-从屏幕上方下落：主进程把窗口移到屏幕上方并驱动下落（复用掉回链路）
  entranceFall: () => ipcRenderer.send('pet-entrance-fall'),
  // 钻地联动：把窗口移到屏幕内随机位置（33 挖地消失后从随机位置钻出用）
  teleportRandom: () => ipcRenderer.send('pet-teleport-random'),
  // 钻地隐藏：窗口整体透明度（0=全透明消除白点/残留，1=恢复可见）
  setOpacity: (v) => ipcRenderer.send('pet-opacity', v),
  getMaxScale: () => ipcRenderer.invoke('pet-get-max-scale'),
  showMenu: () => ipcRenderer.send('show-context-menu'),
  getActions: () => ipcRenderer.invoke('get-actions'),
  // 用户配置（随机表演开关/间隔等，菜单「设置」中调整，持久化到 assets/user-config.json）
  getConfig: () => ipcRenderer.invoke('get-config'),
  onConfigChanged: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
  debugShot: (name) => ipcRenderer.send('debug-shot', name),
  debugLog: (msg) => ipcRenderer.send('debug-log', msg),
  quit: () => ipcRenderer.send('quit'),
  // 退出动画：主进程菜单点「退出桌宠」先通知渲染层播放退出动画（act_49 火箭飞出），播完由渲染层发 quit
  onExitAnim: (cb) => ipcRenderer.on('start-exit-anim', () => cb()),
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
  // 菜单「翻唱历史」播放：主进程发来 {full, vocal, name, dir}
  onSingPlay: (cb) => ipcRenderer.on('sing-play', (_e, r) => cb(r)),
  // 歌词异步补发：播放不等歌词，搜索完成后再显示桌面歌词 {lyrics, title, source}
  onSingLyric: (cb) => ipcRenderer.on('sing-lyric', (_e, r) => cb(r)),
  // 翻唱播放/暂停：歌词窗口按钮 / 翻唱面板按钮 → 主进程 → 这里
  onSingToggle: (cb) => ipcRenderer.on('sing-toggle', () => cb()),
  // 对话窗口打开后请求当前播放状态：回发 sing-state 让按钮显示与面板一致
  onSingAskState: (cb) => ipcRenderer.on('sing-ask-state', () => cb()),
  // 翻唱播放状态广播（playing/paused/ended）→ 主进程 → 歌词窗口按钮/翻唱面板回显
  singState: (s) => ipcRenderer.send('sing-state', s),
  // 桌面歌词窗口控制（渲染层 → 主进程歌词窗口）
  lyricShow: (lyrics, title) => ipcRenderer.send('lyric-show', { lyrics, title }),
  lyricUpdate: (index) => ipcRenderer.send('lyric-update', index),
  lyricProgress: (index, t, dur) => ipcRenderer.send('lyric-progress', { index, t, dur }),
  lyricHide: () => ipcRenderer.send('lyric-hide'),
  // 播放控制：上报当前播放歌名（歌词窗"下一首"定位用）；接收歌词窗 seek → 设置播放位置
  singNow: (name) => ipcRenderer.send('sing-now', name),
  onSingSeek: (cb) => ipcRenderer.on('sing-seek', (_e, t) => cb(t)),
  // 打开翻唱输出文件夹（资源管理器）
  openSingDir: (dir) => ipcRenderer.send('open-sing-dir', dir),
  // 打开对话窗口（右键菜单「说句话…」→ 主进程）
  openChat: () => ipcRenderer.send('chat-open'),
});
