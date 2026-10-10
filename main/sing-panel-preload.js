// 翻唱面板 preload：选文件 / 开始翻唱 / 播放控制 / 历史 / 文件夹 + 主进程推送的进度与状态
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('singPanelApi', {
  pickFile: () => ipcRenderer.invoke('sing-panel-pick'),
  startSing: (p) => ipcRenderer.send('sing-panel-start', p),
  toggle: () => ipcRenderer.send('sing-panel-toggle'),
  setVolume: (v) => ipcRenderer.send('sing-panel-volume', v),
  play: (name) => ipcRenderer.send('sing-panel-play', name),
  openDir: () => ipcRenderer.send('sing-panel-dir'),
  minimize: () => ipcRenderer.send('sing-panel-minimize'),
  close: () => ipcRenderer.send('sing-panel-close'),
  getHistory: () => ipcRenderer.invoke('sing-panel-history'),
  // 拖拽文件取真实路径：sandbox 渲染进程里 File.path 不可用，必须走 webUtils.getPathForFile
  getPathForFile: (file) => (file ? webUtils.getPathForFile(file) : ''),
  // 歌词文件：点击选择 / 拖拽上报（song=当前播放歌名，用于绑定；空路径 = 清空）
  pickLrc: (song) => ipcRenderer.invoke('sing-panel-pick-lrc', song),
  setLrcFile: (p, song) => ipcRenderer.invoke('sing-panel-set-lrc', p, song),
  // 重开桌面歌词窗口
  showLyric: () => ipcRenderer.invoke('sing-panel-lyric'),
  onStart: (cb) => ipcRenderer.on('sing-panel-start', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('sing-progress', (_e, s) => cb(s)),
  onDone: (cb) => ipcRenderer.on('sing-done', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('sing-error', (_e, e) => cb(e)),
  onState: (cb) => ipcRenderer.on('sing-panel-state', (_e, s) => cb(s)),
  // 广播 sing-play（菜单历史/歌词窗"下一首"/面板播放）→ 同步面板"正在播放"歌名
  onSingPlay: (cb) => ipcRenderer.on('sing-play', (_e, r) => cb(r)),
  // 歌词文件被自动清空（播放/切歌到未绑定歌曲时）：面板同步取消勾选
  onLrcCleared: (cb) => ipcRenderer.on('sing-panel-lrc-cleared', () => cb()),
});
