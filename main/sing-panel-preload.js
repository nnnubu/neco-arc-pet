// 翻唱面板 preload：选文件 / 开始翻唱 / 播放控制 / 历史 / 文件夹 + 主进程推送的进度与状态
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('singPanelApi', {
  pickFile: () => ipcRenderer.invoke('sing-panel-pick'),
  startSing: (p) => ipcRenderer.send('sing-panel-start', p),
  toggle: () => ipcRenderer.send('sing-panel-toggle'),
  play: (name) => ipcRenderer.send('sing-panel-play', name),
  openDir: () => ipcRenderer.send('sing-panel-dir'),
  minimize: () => ipcRenderer.send('sing-panel-minimize'),
  close: () => ipcRenderer.send('sing-panel-close'),
  getHistory: () => ipcRenderer.invoke('sing-panel-history'),
  // 拖拽文件取真实路径：sandbox 渲染进程里 File.path 不可用，必须走 webUtils.getPathForFile
  getPathForFile: (file) => (file ? webUtils.getPathForFile(file) : ''),
  onStart: (cb) => ipcRenderer.on('sing-panel-start', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('sing-progress', (_e, s) => cb(s)),
  onDone: (cb) => ipcRenderer.on('sing-done', (_e, r) => cb(r)),
  onError: (cb) => ipcRenderer.on('sing-error', (_e, e) => cb(e)),
  onState: (cb) => ipcRenderer.on('sing-panel-state', (_e, s) => cb(s)),
});
