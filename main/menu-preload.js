// 菜单窗口 preload：暴露菜单数据接收、动作选择、配置修改与关闭
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuApi', {
  onData: (cb) => ipcRenderer.on('menu-data', (_e, d) => cb(d)),
  pick: (id) => ipcRenderer.send('menu-pick', id),
  setConfig: (key, value) => ipcRenderer.send('menu-config-set', key, value),
  close: () => ipcRenderer.send('menu-close'),
});
