// 总面板 preload：导航切换 / 最小化 / 最大化 / 关闭 / 退出桌宠 + 主进程推送的激活模块与最大化状态
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('masterApi', {
  nav: (name) => ipcRenderer.send('master-nav', name),
  minimize: () => ipcRenderer.send('master-minimize'),
  maximize: () => ipcRenderer.send('master-maximize'),
  close: () => ipcRenderer.send('master-close'),
  quit: () => ipcRenderer.send('master-quit'),
  onActive: (cb) => ipcRenderer.on('master-active', (_e, name) => cb(name)),
  onMaxState: (cb) => ipcRenderer.on('master-max-state', (_e, maxed) => cb(!!maxed)),
});
