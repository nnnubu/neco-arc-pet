// 主进程 - 对话模块（整合进总面板）：消息气泡 + 输入行 + 状态 + 翻唱播放控制
// 总面板方案：对话作为 WebContentsView 挂载在主窗口（master-panel）内容区，
// 渲染层/Preload/IPC 完全复用；getChatWin() 返回 view 包装对象（webContents + isDestroyed）
const { ipcMain } = require('electron');
const { getWin } = require('./window');
const { openModule, wrapView, hideMaster, minimizeMaster } = require('./master-panel');
const { getAiConfig, updateAiConfig } = require('./ai');

// ── 消息记录（内存，上限 200 条）：用户输入/猫姬回复/主动说话都进记录，
// 对话模块关闭再打开时回放，避免"主动说话没加到对话面板"（窗口未开时消息丢失）
const MAX_HISTORY = 200;
let chatHistory = [];

function recordMsg(role, text) {
  if (!text) return;
  chatHistory.push({ role: role === 'me' ? 'me' : 'pet', text: String(text), ts: Date.now() });
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);
}

function getHistory() { return chatHistory.slice(); }

function getChatWin() {
  // 总面板模式下返回 view 包装（广播链路 sing.js/voice.js 原样可用）；未创建时返回 null
  return wrapView('chat');
}

// 打开（或切换）对话模块：总面板内
function showChat() {
  openModule('chat');
}

function closeChat() {
  hideMaster();
}

// 对话事件广播：桌宠窗（播放/逐字文字）+ 对话窗（消息/状态显示）
function broadcast(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  const chat = getChatWin();
  if (chat && !chat.isDestroyed()) chat.webContents.send(channel, payload);
}

function registerChatIpc() {
  // 菜单「说句话…」/ 桌宠右键 → 打开对话模块（总面板）
  ipcMain.on('chat-open', () => showChat());
  ipcMain.on('chat-close', () => closeChat());
  ipcMain.on('chat-minimize', () => minimizeMaster());

  // 对话窗打开后同步当前翻唱播放状态：让桌宠渲染层把当前状态走 sing-state 广播回来
  ipcMain.on('chat-ask-state', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-ask-state');
  });

  // 对话窗输入发送 → 复用语音问答链路（voice.js handleSpeakText；运行时 require 防循环依赖）
  // 消息记录统一在 voice.js（handleSpeakText 内记录 me/pet，覆盖对话窗/主窗口两种入口，避免重复）
  ipcMain.on('chat-send', (_e, text, force) => {
    require('./voice').handleSpeakText(String(text || ''), !!force);
  });

  // 对话窗打开时拉取历史消息（invoke 时机可靠，避免 push 时渲染端未就绪丢消息）
  ipcMain.handle('chat-get-history', () => getHistory());

  // 对话窗「播放/暂停」→ 桌宠渲染层 toggle 翻唱播放
  ipcMain.on('chat-toggle-sing', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-toggle');
  });

  // 对话窗「翻唱」入口 → 总面板切到翻唱模块
  ipcMain.on('chat-open-sing-panel', () => openModule('sing'));

  // 联网搜索开关（对话窗控制；持久化到 assets/ai-config.json 的 webSearchEnabled）
  ipcMain.handle('chat-search-state', () => !!getAiConfig().webSearchEnabled);
  ipcMain.handle('chat-search-toggle', () => {
    const next = !getAiConfig().webSearchEnabled;
    updateAiConfig({ webSearchEnabled: next });
    return next;
  });

  // 回答缓存开关（对话窗 💾；持久化到 ai-config.json 的 chatCacheEnabled）
  ipcMain.handle('chat-cache-state', () => getAiConfig().chatCacheEnabled !== false);
  ipcMain.handle('chat-cache-toggle', () => {
    const next = getAiConfig().chatCacheEnabled === false;
    updateAiConfig({ chatCacheEnabled: next });
    return next;
  });

  // 清空回答缓存（对话窗 🗑️）：清 voice/ai_cache.json，返回清理条数
  ipcMain.handle('chat-cache-clear', () => require('./ai').clearAiCache());

  // 静音模式（对话窗按钮）：arc 的 AI 语音/随机发声静音，翻唱音乐不受影响
  ipcMain.handle('chat-mute-state', () => !!getAiConfig().muteVoice);
  ipcMain.handle('chat-mute-toggle', () => {
    const next = !getAiConfig().muteVoice;
    updateAiConfig({ muteVoice: next });
    return next;
  });
}

module.exports = { registerChatIpc, getChatWin, showChat, broadcast, recordMsg, getHistory };
