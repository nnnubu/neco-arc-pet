// TTS 面板 preload：配置读写 / 生成 / 历史 / 播放 / 文件夹 + 主进程推送的完成与错误
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ttsPanelApi', {
  load: () => ipcRenderer.invoke('tts-panel-load'),
  save: (c) => ipcRenderer.invoke('tts-panel-save', c),
  generate: (text, params) => ipcRenderer.invoke('tts-panel-generate', text, params),
  play: (name) => ipcRenderer.invoke('tts-panel-play', name),
  openDir: () => ipcRenderer.send('tts-panel-dir'),
  minimize: () => ipcRenderer.send('tts-panel-minimize'),
  close: () => ipcRenderer.send('tts-panel-close'),
  onDone: (cb) => ipcRenderer.on('tts-done', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('tts-error', (_e, e) => cb(e)),
  // 播放/暂停与桌面歌词：复用翻唱面板的 IPC 通道（同一 singAudio 播放器 + 同一歌词窗口）
  toggle: () => ipcRenderer.send('sing-panel-toggle'),
  showLyric: () => ipcRenderer.invoke('sing-panel-lyric'),
  // 播放状态同步（复用翻唱播放链路 singAudio）
  onState: (cb) => ipcRenderer.on('sing-panel-state', (_e, s) => cb(s)),
  onSingPlay: (cb) => ipcRenderer.on('sing-play', (_e, r) => cb(r)),
  // TTS 播放进度（桌宠渲染层 rAF 每帧上报，经主进程转发）
  onProgress: (cb) => ipcRenderer.on('tts-progress', (_e, p) => cb(p)),
  // 进度条拖动 seek
  seek: (t) => ipcRenderer.send('tts-seek', t),
});
