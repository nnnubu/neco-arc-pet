// 主进程 - 动作面板窗口：独立常驻窗口（自绘标题栏 + 最小化/关闭），
// 点击动作持续播放不关闭，方便连续测试多个动作（菜单每次点完会关，体验差）
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getWin } = require('./window');

let panelWin = null;

function getActionPanelWin() {
  return panelWin;
}

// 打开（或聚焦）动作面板
function showActionPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.show();
    panelWin.focus();
    return;
  }
  panelWin = new BrowserWindow({
    width: 320,
    height: 720,
    frame: false, // 自绘标题栏（可拖动 + 最小化/关闭）
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'action-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'action-panel.html'));
  panelWin.webContents.on('did-finish-load', () => {
    // 运行时 require：menu.js 顶层 require 本模块，本模块顶层不能反向 require menu（避免循环依赖）
    const { buildMenuData } = require('./menu');
    panelWin.webContents.send('action-panel-data', buildMenuData());
  });
  panelWin.on('closed', () => { panelWin = null; });
}

function closeActionPanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
  panelWin = null;
}

function registerActionPanelIpc() {
  // 菜单入口：菜单「动作」模块 → 打开动作面板
  ipcMain.on('action-panel-open', () => showActionPanel());
  ipcMain.on('action-panel-close', () => closeActionPanel());
  ipcMain.on('action-panel-minimize', () => {
    if (panelWin && !panelWin.isDestroyed()) panelWin.minimize();
  });
}

module.exports = { showActionPanel, closeActionPanel, getActionPanelWin, registerActionPanelIpc };
