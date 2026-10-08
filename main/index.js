// 主进程入口：应用生命周期 + 装配各功能模块
// 模块职责：window=窗口与移动缩放 / menu=右键菜单 / voice=语音服务
const { app, BrowserWindow, ipcMain } = require('electron');
const { createWindow, registerWindowIpc } = require('./window');
const { registerMenuIpc } = require('./menu');
const { registerVoiceIpc } = require('./voice');
const { registerSingIpc } = require('./sing');

// 透明窗口加固：Windows 上硬件加速合成偶发导致透明失效变白底，
// 禁用后透明层走软件合成，稳定可靠（像素动画性能不受影响）
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  createWindow();
  registerWindowIpc();
  registerMenuIpc();
  registerVoiceIpc();
  registerSingIpc();
  // 渲染层退出动画（act_49 火箭飞出）播完由渲染层发 quit → 真正退出
  ipcMain.on('quit', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
