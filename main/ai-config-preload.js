// AI 设置面板 preload
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aiConfigApi', {
  load: () => ipcRenderer.invoke('ai-config-load'),
  save: (cfg) => ipcRenderer.invoke('ai-config-save', cfg),
  defaultPrompt: () => ipcRenderer.invoke('ai-config-default-prompt'),
  test: (cfg) => ipcRenderer.invoke('ai-config-test', cfg),
  minimize: () => ipcRenderer.send('ai-config-minimize'),
  close: () => ipcRenderer.send('ai-config-close'),
});
