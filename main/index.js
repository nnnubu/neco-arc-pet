// 主进程入口：应用生命周期 + 装配各功能模块
// 模块职责：window=窗口与移动缩放 / menu=动作与配置 / voice=语音服务 / master-panel=总面板与退出
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
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
const { registerMasterPanelIpc, openModule, requestQuit, isQuitting } = require('./master-panel');

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

  // 系统托盘：桌宠启动即常驻；总面板关闭=隐藏，可从托盘找回；托盘「退出桌宠」走退出动画链路
  setupTray();

  // 桌宠启动同时启动总面板（原右键菜单栏已移除，总面板是唯一功能入口）
  openModule('chat');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 托盘常驻：点击图标/「显示总面板」找回总面板；「退出桌宠」才真正退出（isQuitting 保护 window-all-closed）
let tray = null;
function setupTray() {
  try {
    // 托盘图标：arc 头部透明图标（32px 源图，Windows 按 DPI 自动选用 16/32），比全身帧缩 16px 更清晰
    const icon = nativeImage.createFromPath(
      path.join(__dirname, '..', 'assets', 'icons', 'arc-head-32.png')
    );
    if (icon.isEmpty()) throw new Error('托盘图标加载为空');
    tray = new Tray(icon);
    tray.setToolTip('猫姬桌宠');
    tray.on('click', () => openModule('chat'));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示总面板', click: () => openModule('chat') },
      { type: 'separator' },
      { label: '退出桌宠', click: () => requestQuit() },
    ]));
  } catch (e) {
    console.error('[tray] 托盘创建失败:', e.message);
  }
}

// 平时总面板关闭=隐藏、桌宠窗口常驻 → 所有窗口关闭不代表退出；只有「退出桌宠」才退出进程
app.on('window-all-closed', () => {
  if (isQuitting()) app.quit();
});
