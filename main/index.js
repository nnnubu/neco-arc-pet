// 主进程入口：应用生命周期 + 装配各功能模块
// 模块职责：window=窗口与移动缩放 / menu=右键菜单 / voice=语音服务
const { app, BrowserWindow, ipcMain } = require('electron');
const { createWindow, registerWindowIpc } = require('./window');
const { registerMenuIpc } = require('./menu');
const { registerVoiceIpc } = require('./voice');
const { registerSingIpc } = require('./sing');
const { registerLyricIpc } = require('./lyric');
const { registerSingPanelIpc } = require('./sing-panel');
const { registerChatIpc } = require('./chat');
const { registerAiConfigIpc } = require('./ai-config');
const { registerBubbleIpc } = require('./bubble');
const { registerActionPanelIpc } = require('./action-panel');
const { registerTtsPanelIpc } = require('./tts-panel');
const { registerMasterPanelIpc } = require('./master-panel');

// 透明窗口加固：Windows 上硬件加速合成偶发导致透明失效变白底，
// 禁用后透明层走软件合成，稳定可靠（像素动画性能不受影响）
app.disableHardwareAcceleration();

// 主进程异常兜底：任何未捕获异常只记录不中断进程（Electron 的 ipcMain 回调抛错
// 若直通 uncaughtException 可能导致主进程进入不稳定状态，后续 IPC 消息处理卡住——桌宠表现为"卡住不动"）
process.on('uncaughtException', (e) => {
  console.error('[main] uncaughtException:', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  console.error('[main] unhandledRejection:', e && e.stack ? e.stack : e);
});

app.whenReady().then(() => {
  createWindow();
  registerWindowIpc();
  registerMenuIpc();
  registerVoiceIpc();
  registerSingIpc();
  registerLyricIpc();
  registerSingPanelIpc();
  registerChatIpc();
  registerAiConfigIpc();
  registerActionPanelIpc();
  registerTtsPanelIpc();
  registerMasterPanelIpc();
  // 独立气泡窗口：跟随桌宠窗口定位（透传 window 模块的 getWin）
  registerBubbleIpc(() => require('./window').getWin());
  // 渲染层退出动画（act_49 火箭飞出）播完由渲染层发 quit → 真正退出
  ipcMain.on('quit', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
