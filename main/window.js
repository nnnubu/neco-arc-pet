// 主进程 - 窗口模块：创建透明置顶窗口、位置管理、拖拽、走动、缩放、鼠标轮询
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// 桌宠基准窗口尺寸 = 1.0 倍（像素帧 218x260 的 2 倍显示：436x520，含少量边距）
// 初始即最小：0.5 倍 = 220x265
const WIN_W = 440;
const WIN_H = 530;
const INIT_W = 220;
const INIT_H = 265;

let win = null;
const dragState = { dragging: false, startMouse: null, startWin: null };
let mouseTimer = null;

function getWin() {
  return win;
}

function createWindow() {
  win = new BrowserWindow({
    width: INIT_W,
    height: INIT_H,
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

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 初始位置：主显示器右下角
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    Math.round(workArea.x + workArea.width - INIT_W - 40),
    Math.round(workArea.y + workArea.height - INIT_H - 60)
  );

  if (process.env.PET_DEBUG === '1') {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { debug: '1' } });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
  win.on('closed', () => { win = null; });

  // 全局鼠标位置轮询（25fps），连同窗口位置一起推给渲染层
  mouseTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    win.webContents.send('mouse-pos', { mx: p.x, my: p.y, wx, wy });
  }, 40);
}

function clampTo(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function registerWindowIpc() {
  ipcMain.on('drag-start', () => {
    if (!win || win.isDestroyed()) return;
    dragState.dragging = true;
    dragState.startMouse = screen.getCursorScreenPoint();
    dragState.startWin = win.getPosition();
  });

  ipcMain.on('drag-move', () => {
    if (!win || win.isDestroyed() || !dragState.dragging) return;
    const now = screen.getCursorScreenPoint();
    win.setPosition(
      dragState.startWin[0] + now.x - dragState.startMouse.x,
      dragState.startWin[1] + now.y - dragState.startMouse.y
    );
  });

  ipcMain.on('drag-end', () => {
    dragState.dragging = false;
  });

  // 走动：按增量移动窗口，并限制在主显示器工作区内
  ipcMain.on('move-by', (_e, { dx, dy }) => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const nx = clampTo(x + dx, wa.x, wa.x + wa.width - b.width);
    const ny = clampTo(y + dy, wa.y, wa.y + wa.height - b.height);
    win.setPosition(Math.round(nx), Math.round(ny));
    if (process.env.PET_DEBUG === '1') {
      console.log(`[debug] move-by -> (${Math.round(nx)}, ${Math.round(ny)})`);
    }
  });

  // 鼠标进入窗口时聚焦，便于接收键盘控制
  ipcMain.on('focus-window', () => {
    if (!win || win.isDestroyed()) return;
    if (!win.isFocused()) win.focus();
  });

  ipcMain.on('resize-window', (_e, { width, height }) => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
  });

  // 桌宠缩放：滚轮控制。保持窗口底部位置，水平居中；限制窗口不超出工作区
  // 两阶段流程消除闪烁：先通知渲染层用目标尺寸 resize 画布/精灵 → 渲染层回执 → 再 setBounds 改窗口。
  // 否则窗口先变小、画布还停在旧尺寸，中间帧精灵底部会被窗口裁掉（缩小在正下方闪一下）。
  // 连续滚轮：排队逐档处理（画布就绪后才改窗口）；渲染层卡住时 800ms 超时兜底强制改窗。
  let scaleBusy = false;   // 是否正在"画布就绪→改窗口"流程
  let pendingReq = null;   // 排队中的最新请求
  let currentReq = null;   // 正在处理的请求
  let applyTimer = null;

  function finishScale() {
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    if (!currentReq) return;
    const p = currentReq;
    currentReq = null;
    win.setBounds({ x: p.nx, y: p.ny, width: p.w, height: p.h });
    // 主动通知渲染层新窗口尺寸：canvas 立即跟随（避免依赖 resize 事件丢失导致画布不缩放）
    win.webContents.send('pet-window-resized', { width: p.w, height: p.h });
    scaleBusy = false;
    if (pendingReq) startScale();
  }

  function startScale() {
    if (!pendingReq) return;
    scaleBusy = true;
    currentReq = pendingReq;
    pendingReq = null;
    win.webContents.send('pet-scale-applied', { scale: currentReq.s, width: currentReq.w, height: currentReq.h });
    applyTimer = setTimeout(finishScale, 800); // 渲染层未回执时兜底强制改窗
  }

  ipcMain.on('pet-scale', (_e, scale) => {
    if (!win || win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const maxScale = Math.max(1, Math.min(wa.width / WIN_W, wa.height / WIN_H));
    const s = Math.max(0.5, Math.min(scale, maxScale));
    const w = Math.round(WIN_W * s);
    const h = Math.round(WIN_H * s);
    const b = win.getBounds();
    const nx = clampTo(Math.round(b.x + (b.width - w) / 2), wa.x, wa.x + wa.width - w);
    const ny = clampTo(Math.round(b.y + b.height - h), wa.y, wa.y + wa.height - h);
    console.log(`[scale] req=${scale} applied=${s} bounds=(${nx},${ny},${w},${h})`);
    pendingReq = { s, w, h, nx, ny };
    if (!scaleBusy) startScale();
  });

  // 渲染层画布/精灵已按目标尺寸就绪，此时再改窗口（窗口与画布同步，无中间错位帧）
  ipcMain.on('pet-scale-ready', () => {
    if (scaleBusy && currentReq) finishScale();
  });

  // 渲染层查询最大缩放倍率（窗口不超出工作区）
  ipcMain.handle('pet-get-max-scale', () => {
    const wa = screen.getPrimaryDisplay().workArea;
    return Math.max(1, Math.min(wa.width / WIN_W, wa.height / WIN_H));
  });

  // 调试：渲染层日志转发
  ipcMain.on('debug-log', (_e, msg) => console.log('[renderer]', msg));

  // 调试：渲染层请求截图，保存为 debug-<name>.png
  ipcMain.on('debug-shot', async (_e, name) => {
    if (!win || win.isDestroyed()) return;
    try {
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(path.join(__dirname, '..', `debug-${name}.png`), img.toPNG());
      console.log(`[debug] shot saved: ${name}`);
    } catch (e) {
      console.error('[debug] shot failed:', e);
    }
  });
}

module.exports = { getWin, createWindow, registerWindowIpc };
