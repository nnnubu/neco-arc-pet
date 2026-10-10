// 歌词窗口 preload：暴露主进程推来的歌词数据 / 索引 / 句内进度（卡拉OK渐变）/ 缩放
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lyricApi', {
  onData: (cb) => ipcRenderer.on('lyric-data', (_e, d) => cb(d)),
  onIdx: (cb) => ipcRenderer.on('lyric-idx', (_e, i) => cb(i)),
  onProgress: (cb) => ipcRenderer.on('lyric-progress', (_e, p) => cb(p)),
  // 滚轮缩放：deltaY<0 放大 / >0 缩小 → 主进程调整窗口尺寸与字号
  resize: (deltaY) => ipcRenderer.send('lyric-resize', deltaY),
  onScale: (cb) => ipcRenderer.on('lyric-scale', (_e, s) => cb(s)),
  // JS 拖动窗口（替代 app-region:drag）
  dragStart: (p) => ipcRenderer.send('lyric-drag-start', p),
  dragMove: (p) => ipcRenderer.send('lyric-drag-move', p),
  dragEnd: () => ipcRenderer.send('lyric-drag-end'),
});
