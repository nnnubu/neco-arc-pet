// AI 设置面板 preload
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aiConfigApi', {
  load: () => ipcRenderer.invoke('ai-config-load'),
  save: (cfg) => ipcRenderer.invoke('ai-config-save', cfg),
  defaultPrompt: () => ipcRenderer.invoke('ai-config-default-prompt'),
  test: (cfg) => ipcRenderer.invoke('ai-config-test', cfg),
  proactiveNow: () => ipcRenderer.invoke('ai-config-proactive-now'),
  minimize: () => ipcRenderer.send('ai-config-minimize'),
  close: () => ipcRenderer.send('ai-config-close'),
  // 开发者工具（仅开发版）：一键生成发布包
  isDev: () => ipcRenderer.invoke('app-is-dev'),
  devBuild: (kind) => ipcRenderer.send('dev-build', kind),
  onDevBuild: (cb) => ipcRenderer.on('dev-build-progress', (_e, s) => cb(s)),
});
contextBridge.exposeInMainWorld('necoI18n', {
  get: () => ipcRenderer.invoke('i18n-get'),
  on: (cb) => ipcRenderer.on('i18n-change', (_e, lang) => cb(lang)),
  setLang: (lang) => ipcRenderer.send('i18n-set-lang', lang),
});
