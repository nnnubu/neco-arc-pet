// 主进程 - 翻唱面板窗口：拖拽/选择音频 → 开始翻唱（复用 sing-song 链路）→ 进度/完成/错误回显
//               历史列表播放/暂停控制/打开文件夹；播放由桌宠渲染层执行（singAudio + 桌面歌词）
const { BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getWin } = require('./window');
const { scanSingHistory, getLyricsByTitle } = require('./lyric');
// 注意：不在这里顶层解构 ./sing 的 startSing —— sing.js 与本模块互相 require（sing.js 顶层引 getSingPanelWin），
// 顶层解构会拿到未完成的空导出；改为回调运行时 require（届时模块已完整加载）

let panelWin = null;

function getSingPanelWin() {
  return panelWin;
}

// 打开（或聚焦）翻唱面板
function showSingPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.show();
    panelWin.focus();
    return;
  }
  panelWin = new BrowserWindow({
    width: 400,
    height: 560,
    frame: false, // 自绘标题栏（可拖动 + 关闭按钮）
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'sing-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'sing-panel.html'));
  panelWin.on('closed', () => { panelWin = null; });
}

function closeSingPanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.destroy();
  panelWin = null;
}

function registerSingPanelIpc() {
  // 菜单入口
  ipcMain.on('sing-panel-open', () => showSingPanel());
  ipcMain.on('sing-panel-close', () => closeSingPanel());
  ipcMain.on('sing-panel-minimize', () => {
    if (panelWin && !panelWin.isDestroyed()) panelWin.minimize();
  });

  // 选音频文件（点击拖拽区）
  ipcMain.handle('sing-panel-pick', async () => {
    const r = await dialog.showOpenDialog(panelWin || undefined, {
      title: '选择要翻唱的音频',
      properties: ['openFile'],
      filters: [
        { name: '音频', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'ape'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 面板「开始翻唱」→ 直接走翻唱链路（与输入框「唱 xx」同一入口，进度广播回面板）
  ipcMain.on('sing-panel-start', (_e, p) => {
    require('./sing').startSing(String(p || ''));
  });

  // 面板播放/暂停按钮 → 桌宠渲染层 toggle 翻唱播放
  ipcMain.on('sing-panel-toggle', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-toggle');
  });

  // 面板历史列表播放某首歌 → 立即播放 + 歌词异步补发（广播：桌宠窗播 + 对话窗显示）
  ipcMain.on('sing-panel-play', (_e, name) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    const dir = path.join(__dirname, '..', 'voice', 'sing_output', String(name || ''));
    try {
      const full = fs.readdirSync(dir).find((f) => f.endsWith('_猫姬翻唱.wav'));
      if (!full) return;
      const p = path.join(dir, full);
      if (!fs.existsSync(p)) return; // 文件被删/占位：不播
      require('./sing').broadcast('sing-play', { full: p, vocal: null, name: String(name), dir });
      getLyricsByTitle(String(name)).then((lyr) => {
        if (w && !w.isDestroyed() && lyr && lyr.lyrics && lyr.lyrics.length) {
          w.webContents.send('sing-lyric', lyr);
        }
      }).catch(() => {});
    } catch (e) {}
  });

  // 面板「打开翻唱文件夹」
  ipcMain.on('sing-panel-dir', () => {
    const dir = path.join(__dirname, '..', 'voice', 'sing_output');
    if (fs.existsSync(dir)) shell.openPath(dir);
  });

  // 面板查询历史
  ipcMain.handle('sing-panel-history', () => scanSingHistory());
}

module.exports = { registerSingPanelIpc, getSingPanelWin, showSingPanel };
