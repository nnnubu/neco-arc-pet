// 气泡窗口 preload：接收主进程推送的文本 + 淡出动效指令；上报内容高度（窗口动态自适应）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bubbleApi', {
  onText: (cb) => ipcRenderer.on('bubble-text', (_e, p) => cb(p)),
  onFadeOut: (cb) => ipcRenderer.on('bubble-fadeout', () => cb()),
  resizeContent: (h) => ipcRenderer.send('bubble-resize', h),
});
