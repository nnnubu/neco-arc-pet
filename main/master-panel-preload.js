// 总面板 preload：导航切换 / 最小化 / 最大化 / 关闭 / 退出桌宠 + 语音升级（基础包无语音时拖拽/选择 zip 安装并自动重启）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('masterApi', {
  nav: (name) => ipcRenderer.send('master-nav', name),
  minimize: () => ipcRenderer.send('master-minimize'),
  maximize: () => ipcRenderer.send('master-maximize'),
  close: () => ipcRenderer.send('master-close'),
  quit: () => ipcRenderer.send('master-quit'),
  onActive: (cb) => ipcRenderer.on('master-active', (_e, name) => cb(name)),
  onMaxState: (cb) => ipcRenderer.on('master-max-state', (_e, maxed) => cb(!!maxed)),
  // 语音升级：查询是否已装语音包；打开升级小窗；选择/拖拽 zip 安装；监听安装进度（unpacking/done/error）
  getVoiceStatus: () => ipcRenderer.invoke('voice-upgrade-status'),
  openUpgradeWin: () => ipcRenderer.send('voice-upgrade-open'),
  closeUpgradeWin: () => ipcRenderer.send('voice-upgrade-close'),
  pickVoiceUpgrade: () => ipcRenderer.invoke('voice-upgrade-pick'),
  upgradeVoiceWithPath: (zipPath) => ipcRenderer.send('voice-upgrade-path', zipPath),
  onVoiceUpgrade: (cb) => ipcRenderer.on('voice-upgrade-progress', (_e, s) => cb(s)),
});
contextBridge.exposeInMainWorld('necoI18n', {
  get: () => ipcRenderer.invoke('i18n-get'),
  on: (cb) => ipcRenderer.on('i18n-change', (_e, lang) => cb(lang)),
});
