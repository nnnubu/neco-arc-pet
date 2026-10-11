// 主进程 - 动作面板模块（整合进总面板）：点击动作持续播放不关闭，方便连续测试多个动作
// 总面板方案：作为 WebContentsView 挂载在主窗口内容区，渲染层/Preload/IPC 完全复用
const { ipcMain } = require('electron');
const path = require('path');
const { getWin } = require('./window');
const { openModule, wrapView, hideMaster, minimizeMaster } = require('./master-panel');

let panelWin = null; // 兼容旧引用：总面板模式下由 master-panel 管理

function getActionPanelWin() {
  // 总面板模式下返回 view 包装
  return wrapView('action');
}

// 打开（或切换）动作面板：总面板内
function showActionPanel() {
  openModule('action');
}

function closeActionPanel() {
  hideMaster();
}

function registerActionPanelIpc() {
  // 菜单入口：菜单「动作」模块 → 打开动作面板（总面板内）
  ipcMain.on('action-panel-open', () => showActionPanel());
  ipcMain.on('action-panel-close', () => closeActionPanel());
  ipcMain.on('action-panel-minimize', () => minimizeMaster());
}

module.exports = { showActionPanel, closeActionPanel, getActionPanelWin, registerActionPanelIpc };
