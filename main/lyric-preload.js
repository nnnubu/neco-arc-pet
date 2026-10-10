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
  // 关闭歌词窗口（播放仍在继续，仅隐藏歌词显示；下次播放会自动重新显示）
  hide: () => ipcRenderer.send('lyric-hide'),
  // 播放控制：进度条拖动 seek / 播放暂停 / 上一首 / 下一首（转发到桌宠渲染层）
  seek: (t) => ipcRenderer.send('lyric-seek', t),
  toggle: () => ipcRenderer.send('lyric-toggle'),
  prev: () => ipcRenderer.send('lyric-prev'),
  next: () => ipcRenderer.send('lyric-next'),
  // 播放状态（sing-state 广播 → 主进程转发 lyric-state → 按钮 ⏸/▶ 切换）
  onState: (cb) => ipcRenderer.on('lyric-state', (_e, s) => cb(s)),
});
