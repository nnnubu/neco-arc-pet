// 主进程 - 特殊大动作（48/49）独立临时窗口：分离开桌宠主窗口渲染，避免放大主窗口模糊
// 渲染层发 play-big-action → 创建透明置顶窗口加载 big-action.html（帧按 2 倍渲染）→ 播完 big-close
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let bigWin = null;
const BIG_SCALE = 1.05; // 临时窗口渲染倍率（用户在图看软件 105% 认可；原始像素帧，清晰）

// 解析 PNG 宽高（IHDR 头部：字节 16-23 大端）
function pngSize(p) {
  try {
    const b = fs.readFileSync(p);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return { w: 440, h: 530 };
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return { w: 440, h: 530 };
  }
}

function registerBigActionIpc() {
  ipcMain.on('play-big-action', (_e, { name, frames }) => {
    if (bigWin && !bigWin.isDestroyed()) bigWin.close();
    // 独立窗口用原始分辨率帧（big_actions/），不经过归一化迁移缩放——原始像素清晰
    const first = path.join(__dirname, '..', 'assets', 'sprite', 'big_actions', name, '1.png');
    const { w, h } = pngSize(first);
    bigWin = new BrowserWindow({
      width: Math.round(w * BIG_SCALE),
      height: Math.round(h * BIG_SCALE),
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    bigWin.setAlwaysOnTop(true, 'screen-saver');
    // 初始位置：主桌宠窗口正上方居中
    const { getWin } = require('./window');
    const mw = getWin();
    if (mw && !mw.isDestroyed()) {
      const [mx, my] = mw.getPosition();
      const mb = mw.getBounds();
      bigWin.setPosition(
        Math.round(mx + (mb.width - w * BIG_SCALE) / 2),
        Math.round(my - h * BIG_SCALE + 40)
      );
    }
    bigWin.loadFile(path.join(__dirname, '..', 'renderer', 'big-action.html'), {
      query: { name, frames: String(frames), scale: String(BIG_SCALE) },
    });
    bigWin.on('closed', () => { bigWin = null; });
  });

  ipcMain.on('big-close', () => {
    if (bigWin && !bigWin.isDestroyed()) bigWin.close();
  });

  // 临时窗口内移动（49 点火后向上平移）
  ipcMain.on('big-move-by', (_e, { dx, dy }) => {
    if (!bigWin || bigWin.isDestroyed()) return;
    const [x, y] = bigWin.getPosition();
    bigWin.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
}

module.exports = { registerBigActionIpc };
