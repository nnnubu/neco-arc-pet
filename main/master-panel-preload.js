// 总面板 preload：导航切换 / 最小化 / 关闭 + 主进程推送的当前激活模块
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('masterApi', {
  nav: (name) => ipcRenderer.send('master-nav', name),
  minimize: () => ipcRenderer.send('master-minimize'),
  close: () => ipcRenderer.send('master-close'),
  onActive: (cb) => ipcRenderer.on('master-active', (_e, name) => cb(name)),
});
