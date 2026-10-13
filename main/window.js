// 主进程 - 窗口模块：创建透明置顶窗口、位置管理、拖拽、走动、缩放、鼠标轮询
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { getAssetRoot } = require('./paths');

// 桌宠基准窗口尺寸 = 1.0 倍（像素帧 218x260 的 2 倍显示：436x520，含少量边距）
// 初始即最小：0.5 倍 = 220x265
const WIN_W = 440;
const WIN_H = 530;
const INIT_W = 220;
const INIT_H = 265;

let win = null;
const dragState = { dragging: false, startMouse: null, startWin: null };
let mouseTimer = null;
let opacityRestoreTimer = null; // resize 期间窗口透明化的恢复定时器（连续 resize 只恢复最后一次）

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
    icon: path.join(getAssetRoot(), 'icons', 'arc.ico'), // 窗口/任务栏显示 arc 图标（替代 electron 默认）
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 关键：禁用后台节流。否则桌宠窗口被其他置顶窗口（翻唱面板/菜单/歌词窗）完全遮挡时，
      // Chromium 判定页面不可见 → 暂停 rAF → PixiJS 动画循环停 → "桌宠卡住不动"。
      // 桌宠必须始终在渲染（呼吸/待机/随机动作），遮挡不影响动画。
      backgroundThrottling: false,
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

  // 全局鼠标位置轮询（25fps），连同窗口位置一起推给渲染层；顺带做水平环绕检查
  mouseTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    // 水平环绕：窗口完全出左/出右 → 对侧同偏移补回（主进程驱动，出屏期间渲染暂停也不中断）
    const wa = screen.getPrimaryDisplay().workArea;
    const b = win.getBounds();
    const wx2 = wrapAroundX(b, wa);
    if (wx2 !== b.x) win.setPosition(Math.round(wx2), b.y);
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    win.webContents.send('mouse-pos', { mx: p.x, my: p.y, wx, wy });
  }, 40);
}

function clampTo(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 水平环绕穿屏（仅左右）：出屏量超过窗口宽度一半时，把窗口整体平移到对侧——出右半身、左半身
// 从对侧露出，反之亦然，视觉上像穿过屏幕两侧的"传送门"（半边消失、半边在对侧出现）。
// 窗口始终保留至少一半在工作区内，Chromium 渲染循环不会暂停，由主进程轮询（mouseTimer 40ms）
// 检测并补回，移动不中断。垂直方向不做环绕：走出上下边由 fallCheckTimer 触发下落掉回底部。
function wrapAroundX(b, wa) {
  let x = b.x;
  const halfW = Math.round(b.width * 0.5);
  if (b.x + b.width <= wa.x + halfW) x += wa.width;      // 出左超过一半 → 右侧露出
  else if (b.x >= wa.x + wa.width - halfW) x -= wa.width; // 出右超过一半 → 左侧露出
  return x;
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
    // 水平自由（完全出屏由轮询环绕回对侧）；垂直自由（走出上下边由 fallCheckTimer 触发下落掉回）
    const nx = dragState.startWin[0] + now.x - dragState.startMouse.x;
    const ny = dragState.startWin[1] + now.y - dragState.startMouse.y;
    win.setPosition(Math.round(nx), Math.round(ny));
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

  // 走动：按增量移动窗口——水平自由（完全出屏由轮询环绕回对侧）；垂直自由（走出上下边
  // 由 fallCheckTimer 检测后触发下落：出顶直接掉回底部，出底先瞬移到顶部再掉回底部）
  ipcMain.on('move-by', (_e, { dx, dy }) => {
    stopScaleAnim(); // 走动优先：缩放动画会覆盖移动，造成"走不动"
    if (fallAnim) return; // 下落中忽略移动请求：乱跑/按键不会中断下落（2.2 秒后自然完成；拖拽 drag-start 仍可打断交还控制权）
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const nx = x + dx;
    const ny = y + dy;
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
      // 透明化-移动-恢复：避免透明窗口快速 resize 时 DWM 合成拖影（左上/右上残影）。
      // 窗口在 resize 期间整体透明（比 hide/show 更彻底——DWM 不会对全透明窗口合成旧帧，
      // 大跨度放大如 act_91 220→1229px 单步仍可能拖影），短暂延迟后恢复可见。
      if (opacityRestoreTimer) clearTimeout(opacityRestoreTimer);
      win.setOpacity(0);
      win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
      opacityRestoreTimer = setTimeout(() => {
        opacityRestoreTimer = null;
        if (win && !win.isDestroyed()) win.setOpacity(1);
      }, 60);
      // 窗口尺寸/位置变化后立即推送一次全局鼠标位置：渲染层马上重评估穿透状态，
      // 避免大动作播放（hide/show 放大→恢复）后穿透状态残留（鼠标在角色上却持续穿透，点不到/拖不动）
      try {
        const cp = screen.getCursorScreenPoint();
        const [nwx, nwy] = win.getPosition();
        win.webContents.send('mouse-pos', { mx: cp.x, my: cp.y, wx: nwx, wy: nwy });
      } catch (e) { /* 窗口销毁瞬间忽略 */ }
    } else {
      const [x, y] = win.getPosition();
      win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
    }
  });

  // 掉回底部驱动：入场下落（pet-entrance-fall）与"顶部出屏自动掉回"（fallCheckTimer）使用。
  // 出屏后 Chromium 渲染循环暂停，rAF/位移不推进，必须主进程直接驱动窗口向下掉落。
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

  // 上下出屏检测：桌宠走出屏幕顶部或底部超过窗口高度 40% 并持续 FALL_BACK_DELAY，
  // 自动触发"下落掉回底部"（播放下落动画 act_19 + 主进程驱动下落）——"上下边走出屏幕就自动触发下落逻辑"。
  // 出顶：当前位置已在屏幕上方，直接下落；出底：先瞬移到屏幕上方出屏位置，再从上方掉回底部（与出顶同方向）
  let outTopMs = 0, outBottomMs = 0;
  const FALL_BACK_DELAY = 2000;
  const fallCheckTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    if (b.y < wa.y - Math.round(b.height * 0.4)) {
      outTopMs += 1000;
      if (outTopMs >= FALL_BACK_DELAY) {
        outTopMs = 0;
        startFallBack();
        if (process.env.PET_DEBUG === '1') console.log('[fallback] top trigger at y=' + b.y);
      }
    } else {
      outTopMs = 0;
    }
    if (b.y > wa.y + wa.height - Math.round(b.height * 0.4)) {
      outBottomMs += 1000;
      if (outBottomMs >= FALL_BACK_DELAY) {
        outBottomMs = 0;
        // 瞬移到屏幕上方出屏位置（x 保持当前水平位置），再从上方下落掉回底部
        win.setPosition(Math.round(b.x), wa.y - Math.round(b.height * 0.9));
        startFallBack();
        if (process.env.PET_DEBUG === '1') console.log('[fallback] bottom trigger at y=' + b.y);
      }
    } else {
      outBottomMs = 0;
    }
  }, 1000);

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

  // 鼠标穿透：渲染层判断鼠标是否在角色像素上，不在时窗口忽略鼠标事件（点击穿透到下层窗口/桌面），
  // 避免"透明窗口矩形整块拦截鼠标、点桌宠附近被误判拖拽"；鼠标回到角色上时恢复接收
  ipcMain.on('pet-ignore-mouse', (_e, ignore) => {
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  // 渲染层获取动作帧 alpha 包围盒（角色像素范围判断用）：读 JSON 返回对象
  ipcMain.handle('get-frame-bbox', () => {
    try {
      return JSON.parse(require('fs').readFileSync(path.join(getAssetRoot(), 'sprite', 'frame_bbox.json'), 'utf-8'));
    } catch (e) {
      return null;
    }
  });

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
