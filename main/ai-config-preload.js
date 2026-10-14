// AI 设置面板 preload
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aiConfigApi', {
  load: () => ipcRenderer.invoke('ai-config-load'),
  save: (cfg) => ipcRenderer.invoke('ai-config-save', cfg),
  defaultPrompt: () => ipcRenderer.invoke('ai-config-default-prompt'),
  test: (cfg) => ipcRenderer.invoke('ai-config-test', cfg),
  proactiveNow: () => ipcRenderer.invoke('ai-config-proactive-now'),
  testTts: (provider) => ipcRenderer.invoke('voice-test-tts', provider),
  minimize: () => ipcRenderer.send('ai-config-minimize'),
  maximize: () => ipcRenderer.send('master-maximize'),
  onMaxState: (cb) => ipcRenderer.on('master-max-state', (_e, m) => cb(!!m)),
  close: () => ipcRenderer.send('ai-config-close'),
});
contextBridge.exposeInMainWorld('necoI18n', {
  get: () => ipcRenderer.invoke('i18n-get'),
  on: (cb) => ipcRenderer.on('i18n-change', (_e, lang) => cb(lang)),
  setLang: (lang) => ipcRenderer.send('i18n-set-lang', lang),
});
