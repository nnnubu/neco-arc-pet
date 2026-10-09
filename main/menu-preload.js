// 菜单窗口 preload：暴露菜单数据接收与动作选择/关闭
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuApi', {
  onData: (cb) => ipcRenderer.on('menu-data', (_e, d) => cb(d)),
  pick: (id) => ipcRenderer.send('menu-pick', id),
  close: () => ipcRenderer.send('menu-close'),
});
