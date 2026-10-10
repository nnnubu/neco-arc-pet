// 对话窗口 preload：发送文本 / 重新合成 / 翻唱播放控制 + 主进程广播的对话状态
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chatApi', {
  sendText: (text, force) => ipcRenderer.send('chat-send', text, !!force),
  toggleSing: () => ipcRenderer.send('chat-toggle-sing'),
  openSingPanel: () => ipcRenderer.send('chat-open-sing-panel'),
  minimize: () => ipcRenderer.send('chat-minimize'),
  close: () => ipcRenderer.send('chat-close'),
  // 联网搜索开关（状态持久化在主进程 ai 配置）
  searchState: () => ipcRenderer.invoke('chat-search-state'),
  toggleSearch: () => ipcRenderer.invoke('chat-search-toggle'),
  // 打开时向桌宠渲染层同步当前翻唱播放状态（按钮显示 ▶/⏸ 与面板一致）
  askState: () => ipcRenderer.send('chat-ask-state'),
  // 主进程广播（voice.js / sing.js broadcast → 桌宠窗 + 对话窗）
  onSpeakState: (cb) => ipcRenderer.on('speak-state', (_e, s) => cb(s)),
  onAiToken: (cb) => ipcRenderer.on('ai-token', (_e, r) => cb(r)),
  onAiReply: (cb) => ipcRenderer.on('ai-reply', (_e, r) => cb(r)),
  onSingProgress: (cb) => ipcRenderer.on('sing-progress', (_e, s) => cb(s)),
  onSingDone: (cb) => ipcRenderer.on('sing-done', (_e, r) => cb(r)),
  onSingError: (cb) => ipcRenderer.on('sing-error', (_e, e) => cb(e)),
  onSingPlay: (cb) => ipcRenderer.on('sing-play', (_e, r) => cb(r)),
  onSingState: (cb) => ipcRenderer.on('sing-state', (_e, s) => cb(s)),
});
