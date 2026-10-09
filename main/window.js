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

// 环绕穿屏：去掉左右/上下板边限制——窗口离开工作区一侧约 90%（几乎走出屏幕，保留小尾巴
// 保证 Chromium 渲染循环不暂停）时，从对侧边缘补回：出左→右、出右→左、出顶→底、出底→顶
function wrapAround(b, wa) {
  let x = b.x, y = b.y;
  const overX = Math.round(b.width * 0.1);
  const overY = Math.round(b.height * 0.1);
  if (b.x + b.width <= wa.x + overX) x += wa.width;
  else if (b.x >= wa.x + wa.width - overX) x -= wa.width;
  if (b.y + b.height <= wa.y + overY) y += wa.height;
  else if (b.y >= wa.y + wa.height - overY) y -= wa.height;
  return [x, y];
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
    if (fallAnim) { clearInterval(fallAnim); fallAnim = null; } // 用户拖拽：取消下落动画
    if (!win || win.isDestroyed()) return;
    dragState.dragging = true;
    dragState.startMouse = screen.getCursorScreenPoint();
    dragState.startWin = win.getPosition();
  });

  ipcMain.on('drag-move', () => {
    if (!win || win.isDestroyed() || !dragState.dragging) return;
    if (fallAnim) { clearInterval(fallAnim); fallAnim = null; } // 拖拽中：取消下落动画，交还控制权
    const now = screen.getCursorScreenPoint();
    const nx = dragState.startWin[0] + now.x - dragState.startMouse.x;
    const ny = dragState.startWin[1] + now.y - dragState.startMouse.y;
    // 拖拽同样环绕穿屏：拖出屏幕约 90% 从对侧出现
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const wrapped = wrapAround({ x: Math.round(nx), y: Math.round(ny), width: b.width, height: b.height }, wa);
    win.setPosition(wrapped[0], wrapped[1]);
  });

  ipcMain.on('drag-end', () => {
    dragState.dragging = false;
  });

  // 钻地联动：窗口移到屏幕内随机位置（渲染层 33 挖地消失后随机钻出用）
  ipcMain.on('pet-teleport-random', () => {
    if (!win || win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const x = wa.x + Math.round(Math.random() * (wa.width - b.width));
    const y = wa.y + Math.round(Math.random() * (wa.height - b.height));
    win.setPosition(x, y);
  });

  // 钻地隐藏：窗口整体透明度（0 全透明消除白点/残留，1 恢复可见）
  ipcMain.on('pet-opacity', (_e, v) => {
    if (!win || win.isDestroyed()) return;
    win.setOpacity(Math.max(0, Math.min(1, v)));
  });

  // 入场动画-从屏幕上方下落：把窗口移到工作区顶部上方（底部露出一点，保证渲染循环不暂停），
  // 立即启动既有掉回链路（主进程 2.2 秒驱动窗口掉到底部，露出后发 pet-fall-back 播放下落动画，落底发 pet-fall-done）
  ipcMain.on('pet-entrance-fall', () => {
    if (!win || win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const x = wa.x + Math.round(Math.random() * (wa.width - b.width));
    // 窗口顶部出屏 90%（底部露 10%）：Chromium 渲染循环保持运行，下落动画能播
    win.setPosition(x, wa.y - Math.round(b.height * 0.9));
    startFallBack();
  });

  // 走动：按增量移动窗口，去掉左右/上下板边限制（环绕穿屏：出屏约 90% 从对侧出现）
  ipcMain.on('move-by', (_e, { dx, dy }) => {
    stopScaleAnim(); // 走动优先：缩放动画会覆盖移动，造成"走不动"
    if (fallAnim) return; // 下落中忽略移动请求：乱跑/按键不会中断下落（2.2 秒后自然完成；拖拽 drag-start 仍可打断交还控制权）
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const wrapped = wrapAround({ x: Math.round(x + dx), y: Math.round(y + dy), width: b.width, height: b.height }, wa);
    win.setPosition(wrapped[0], wrapped[1]);
    if (process.env.PET_DEBUG === '1') {
      console.log(`[debug] move-by -> (${wrapped[0]}, ${wrapped[1]})`);
    }
  });

  // 鼠标进入窗口时聚焦，便于接收键盘控制
  ipcMain.on('focus-window', () => {
    if (!win || win.isDestroyed()) return;
    if (!win.isFocused()) win.focus();
  });

  ipcMain.on('resize-window', (_e, { width, height, keepBottom }) => {
    if (!win || win.isDestroyed()) return;
    stopScaleAnim(); // 播放特殊大动作时停止缩放动画，避免动画 setBounds 覆盖放大后的窗口位置
    if (keepBottom) {
      // 底部保持不动 + 水平居中（48/49 特殊大动作播放时窗口临时放大，避免角色跳位）
      // 放大后 clamp 到工作区内：桌宠在屏幕上方时，keepBottom 会让窗口顶部超出屏幕
      // （火箭内容跑到屏外不可见），clamp 保证窗口/画面完整可见
      const b = win.getBounds();
      const wa = screen.getPrimaryDisplay().workArea;
      const x = Math.round(clampTo(b.x + (b.width - width) / 2, wa.x, wa.x + wa.width - width));
      const y = Math.round(clampTo(b.y + b.height - height, wa.y, wa.y + wa.height - height));
      // 隐藏-移动-显示：避免透明窗口快速 resize 时 DWM 合成拖影（左上角残影）
      win.hide();
      win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
      win.show();
    } else {
      const [x, y] = win.getPosition();
      win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
    }
  });

  // 掉回底部驱动（入场下落 pet-entrance-fall 使用；出屏后 Chromium 渲染循环暂停，rAF/位移不推进，
  // 必须主进程直接驱动窗口向下掉落；原先"顶部停留 4 秒自动掉回"的兜底检测已移除——上下板边改为环绕穿屏，
  // 出顶 90% 会自动从底部出现，无需再掉回）
  let fallAnim = null;
  function startFallBack() {
    if (fallAnim || !win || win.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const b0 = win.getBounds();
    const targetBottom = wa.y + wa.height;
    const startT = Date.now();
    const DUR = 2200; // 2.2 秒掉到工作区底部（比 1.5s 慢：每帧位移更小更平滑，且更接近 act_19 动画时长）
    let sent = false; // 窗口进入可见区后再通知渲染层播放 act_19（出屏时渲染暂停，动画播了也看不到）
    fallAnim = setInterval(() => {
      try {
        if (!win || win.isDestroyed()) { clearInterval(fallAnim); fallAnim = null; return; }
        const t = Math.min(1, (Date.now() - startT) / DUR);
        const b = win.getBounds();
        const targetY = Math.max(b0.y, targetBottom - b.height); // 只向下（目标不低于起始位置；出屏时取工作区底部位置）
        win.setPosition(Math.round(b.x), Math.round(b0.y + (targetY - b0.y) * t));
        const b2 = win.getBounds();
        // 窗口露出足够多（底部进入工作区 100px，rAF 已恢复）后再通知渲染层播放 act_19
        // （刚露 5px 时 Chromium 渲染循环可能仍暂停，动画卡住/跳帧）
        if (!sent && b2.y + b2.height > wa.y + 100) {
          sent = true;
          win.webContents.send('pet-fall-back');
          if (process.env.PET_DEBUG === '1') console.log('[fallback] act_19 播放 at y=' + b2.y);
        }
        if (t >= 1) {
          clearInterval(fallAnim); fallAnim = null;
          win.webContents.send('pet-fall-done'); // 已抵达底部：通知渲染层结束 act_19 回待机（动画不落地后空播）
        }
      } catch (e) {
        // 任何异常（如窗口状态异常导致 setPosition 失败）：立即清除动画，防止 fallAnim 残留锁死窗口
        clearInterval(fallAnim); fallAnim = null;
        if (process.env.PET_DEBUG === '1') console.log('[fallback] error cleared: ' + e.message);
      }
    }, 8); // 8ms 更新（比 16ms 更平滑）
    // 兜底：下落动画异常（如 setInterval 被系统节流导致迟迟到不了 t=1）时，
    // 强制把窗口放到目标底部位置并结束动画，确保永远不会卡在半空
    setTimeout(() => {
      if (fallAnim) {
        clearInterval(fallAnim); fallAnim = null;
        try {
          const wa2 = screen.getPrimaryDisplay().workArea;
          const b3 = win.getBounds();
          win.setPosition(Math.round(b3.x), Math.max(b0.y, wa2.y + wa2.height - b3.height));
          win.webContents.send('pet-fall-done');
          if (process.env.PET_DEBUG === '1') console.log('[fallback] hard-stop at bottom');
        } catch (e) { /* 窗口已销毁则忽略 */ }
      }
    }, DUR + 800);
  }

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
