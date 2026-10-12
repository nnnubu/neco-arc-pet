// 动作面板 preload：接收动作数据 / 选择动作（复用 menu-pick 链路，转发给桌宠但不关面板）/
// 读取/修改随机表演配置（复用 get-config / menu-config-set，与旧菜单设置区同链路）/ 最小化 / 关闭
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('actionPanelApi', {
  onData: (cb) => ipcRenderer.on('action-panel-data', (_e, d) => cb(d)),
  // 与菜单同一 pick 链路：主进程转发给桌宠渲染层播放；menu-pick 里的 closeMenu 只关菜单窗口，不影响本面板
  pick: (id) => ipcRenderer.send('menu-pick', id),
  // 随机表演配置读写（动作设置区）：get-config 读取，menu-config-set 写入并广播给桌宠即时生效
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.send('menu-config-set', key, value),
  minimize: () => ipcRenderer.send('action-panel-minimize'),
  close: () => ipcRenderer.send('action-panel-close'),
});
contextBridge.exposeInMainWorld('necoI18n', {
  get: () => ipcRenderer.invoke('i18n-get'),
  on: (cb) => ipcRenderer.on('i18n-change', (_e, lang) => cb(lang)),
});
