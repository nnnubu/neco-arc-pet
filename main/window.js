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
  // 立即停止缩放动画（拖拽/走动优先：动画 setBounds 会反复覆盖用户操作，造成残影/位置丢失）
  function stopScaleAnim() {
    if (scaleAnim) {
      clearInterval(scaleAnim.timer);
      scaleAnim = null;
    }
  }

  ipcMain.on('drag-start', () => {
    stopScaleAnim();
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
    stopScaleAnim(); // 走动优先：缩放动画会覆盖移动，造成"走不动"
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
  // 平滑缩放动画：窗口逐帧（16ms）向目标尺寸/位置指数趋近，每步同步通知渲染层
  // （画布 resize 到窗口尺寸、精灵按 scale=高度/WIN_H 反推），窗口与画面始终同步，
  // 避免瞬跳缩放时窗口与画布尺寸错位的中间帧（表现为缩放时"闪一下"）。
  // 连续滚轮：动画进行中直接更新目标，平滑连续缩放。
  let scaleAnim = null; // { timer, target:{w,h,nx,ny}, cur:{x,y,w,h} }

  ipcMain.on('pet-scale', (_e, scale) => {
    if (!win || win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const maxScale = Math.max(1, Math.min(wa.width / WIN_W, wa.height / WIN_H));
    const s = Math.max(0.5, Math.min(scale, maxScale));
    const tw = Math.round(WIN_W * s);
    const th = Math.round(WIN_H * s);
    const b = win.getBounds();
    const tnx = clampTo(Math.round(b.x + (b.width - tw) / 2), wa.x, wa.x + wa.width - tw);
    const tny = clampTo(Math.round(b.y + b.height - th), wa.y, wa.y + wa.height - th);
    console.log(`[scale] req=${scale} applied=${s} target=(${tnx},${tny},${tw},${th})`);

    if (scaleAnim) {
      // 动画进行中：更新目标（连续滚轮平滑改向）
      scaleAnim.target = { w: tw, h: th, nx: tnx, ny: tny };
      return;
    }

    const anim = {
      target: { w: tw, h: th, nx: tnx, ny: tny },
      cur: { x: b.x, y: b.y, w: b.width, h: b.height },
      timer: null,
    };
    scaleAnim = anim;
    anim.timer = setInterval(() => {
      const a = scaleAnim;
      if (!a || !win || win.isDestroyed()) { if (a) { clearInterval(a.timer); scaleAnim = null; } return; }
      // 用户开始拖拽/走动：立即取消动画，把窗口控制权交还（避免 setBounds 覆盖用户操作）
      if (dragState.dragging) { clearInterval(a.timer); scaleAnim = null; return; }
      const t = a.target;
      const c = a.cur;
      const k = 0.25; // 每步走剩余距离的 25%，平滑减速
      let nw = c.w + (t.w - c.w) * k;
      let nh = c.h + (t.h - c.h) * k;
      let nx = c.x + (t.nx - c.x) * k;
      let ny = c.y + (t.ny - c.y) * k;
      const done = Math.abs(t.w - nw) < 1 && Math.abs(t.h - nh) < 1 &&
                   Math.abs(t.nx - nx) < 1 && Math.abs(t.ny - ny) < 1;
      if (done) { nw = t.w; nh = t.h; nx = t.nx; ny = t.ny; }
      const rw = Math.round(nw), rh = Math.round(nh), rx = Math.round(nx), ry = Math.round(ny);
      win.setBounds({ x: rx, y: ry, width: rw, height: rh });
      // 每步通知渲染层：画布 resize 到窗口尺寸、精灵按 scale 反推，窗口与画面始终同步
      win.webContents.send('pet-window-resized', { width: rw, height: rh, scale: rh / WIN_H });
      if (done) {
        clearInterval(a.timer);
        scaleAnim = null;
      } else {
        a.cur = { x: rx, y: ry, w: rw, h: rh };
      }
    }, 16);
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
