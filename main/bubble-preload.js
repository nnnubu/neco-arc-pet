// 气泡窗口 preload：接收主进程推送的文本
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bubbleApi', {
  onText: (cb) => ipcRenderer.on('bubble-text', (_e, t) => cb(t)),
});
