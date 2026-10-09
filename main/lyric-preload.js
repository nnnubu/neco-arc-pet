// 歌词窗口 preload：暴露主进程推来的歌词数据 / 索引 / 句内进度（卡拉OK渐变）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lyricApi', {
  onData: (cb) => ipcRenderer.on('lyric-data', (_e, d) => cb(d)),
  onIdx: (cb) => ipcRenderer.on('lyric-idx', (_e, i) => cb(i)),
  onProgress: (cb) => ipcRenderer.on('lyric-progress', (_e, p) => cb(p)),
});
