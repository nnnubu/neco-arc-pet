// 主进程 - 对话窗口模块：消息气泡 + 输入行 + 状态 + 翻唱播放控制（暂停不再依赖歌词窗口）
// 位置：打开时放桌宠右侧（空间不足则左侧），不遮住桌宠；可拖动
// 事件广播：voice.js / sing.js 用本模块的 broadcast() 把对话相关事件同时发给桌宠窗 + 对话窗
//   （桌宠窗负责播放音频/透明文字逐字，对话窗负责消息与状态显示）
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { getWin } = require('./window');
const { showSingPanel } = require('./sing-panel');

let chatWin = null;

function getChatWin() {
  return chatWin;
}

// 打开（或聚焦）对话窗口：默认放桌宠右侧；右侧空间不足放左侧；尽量不遮桌宠
function showChat() {
  // 临时诊断：记录每次打开调用
  try {
    require('fs').appendFileSync(path.join(__dirname, '..', 'voice', 'actions.log'),
      `${new Date().toISOString()} [chat] showChat chatWin=${chatWin && !chatWin.isDestroyed() ? 'exists' : 'null'}\n`);
  } catch (e) {}
  if (chatWin && !chatWin.isDestroyed()) {
    // 已存在：恢复最小化 + 显示 + 聚焦（防止首次创建后窗口未完成加载时用户重复点击）
    if (chatWin.isMinimized()) chatWin.restore();
    chatWin.show();
    chatWin.focus();
    return;
  }
  const W = 380, H = 500;
  const wa = screen.getPrimaryDisplay().workArea;
  const pet = getWin();
  let x = wa.x + wa.width - W - 40;
  let y = wa.y + wa.height - H - 40;
  if (pet && !pet.isDestroyed()) {
    const b = pet.getBounds();
    x = b.x + b.width + 16;
    if (x + W > wa.x + wa.width) x = Math.max(wa.x + 8, b.x - W - 16);
    y = Math.max(wa.y + 8, Math.min(b.y, wa.y + wa.height - H - 8));
  }
  chatWin = new BrowserWindow({
    width: W, height: H, x: Math.round(x), y: Math.round(y),
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    fullscreenable: false,
    backgroundColor: '#16161f',
    show: true, // 创建后立即显示（避免菜单点击后"没反应"的感知）
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chatWin.loadFile(path.join(__dirname, '..', 'renderer', 'chat.html'));
  chatWin.on('closed', () => { chatWin = null; });
  // 加载完成后再次显示并聚焦（首次点击菜单后窗口立即可见）
  chatWin.webContents.once('did-finish-load', () => {
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.show();
      chatWin.focus();
    }
  });
}

function closeChat() {
  if (chatWin && !chatWin.isDestroyed()) chatWin.destroy();
  chatWin = null;
}

// 对话事件广播：桌宠窗（播放/逐字文字）+ 对话窗（消息/状态显示）
function broadcast(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send(channel, payload);
}

function registerChatIpc() {
  // 菜单「说句话…」/ 桌宠右键 → 打开对话窗口
  ipcMain.on('chat-open', () => showChat());
  ipcMain.on('chat-close', () => closeChat());
  ipcMain.on('chat-minimize', () => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.minimize();
  });

  // 对话窗打开后同步当前翻唱播放状态：让桌宠渲染层把当前状态走 sing-state 广播回来
  ipcMain.on('chat-ask-state', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-ask-state');
  });

  // 对话窗输入发送 → 复用语音问答链路（voice.js handleSpeakText；运行时 require 防循环依赖）
  ipcMain.on('chat-send', (_e, text, force) => {
    require('./voice').handleSpeakText(String(text || ''), !!force);
  });

  // 对话窗「播放/暂停」→ 桌宠渲染层 toggle 翻唱播放
  ipcMain.on('chat-toggle-sing', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-toggle');
  });

  // 对话窗「翻唱」入口 → 打开翻唱面板
  ipcMain.on('chat-open-sing-panel', () => showSingPanel());
}

module.exports = { registerChatIpc, getChatWin, showChat, broadcast };
