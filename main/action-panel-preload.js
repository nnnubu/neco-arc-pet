// 动作面板 preload：接收动作数据 / 选择动作（复用 menu-pick 链路，转发给桌宠但不关面板）/ 最小化 / 关闭
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('actionPanelApi', {
  onData: (cb) => ipcRenderer.on('action-panel-data', (_e, d) => cb(d)),
  // 与菜单同一 pick 链路：主进程转发给桌宠渲染层播放；menu-pick 里的 closeMenu 只关菜单窗口，不影响本面板
  pick: (id) => ipcRenderer.send('menu-pick', id),
  minimize: () => ipcRenderer.send('action-panel-minimize'),
  close: () => ipcRenderer.send('action-panel-close'),
});
