// 总面板 preload：导航切换 / 最小化 / 最大化 / 关闭 / 退出桌宠 + 语音升级 + 开发者一键打包
const { contextBridge, ipcRenderer, webUtils } = require('electron');
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
  // 拖拽文件：新版 Electron 移除了 File.path，必须经 webUtils 取真实路径
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // 开发者工具（仅开发版）：是否开发版 + 一键生成发布包
  isDev: () => ipcRenderer.invoke('app-is-dev'),
  devBuild: (kind) => ipcRenderer.send('dev-build', kind),
  onDevBuild: (cb) => ipcRenderer.on('dev-build-progress', (_e, s) => cb(s)),
});
contextBridge.exposeInMainWorld('necoI18n', {
  get: () => ipcRenderer.invoke('i18n-get'),
  on: (cb) => ipcRenderer.on('i18n-change', (_e, lang) => cb(lang)),
});
