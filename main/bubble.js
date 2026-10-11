// 主进程 - 独立气泡窗口模块
// 桌宠精灵几乎占满主窗口，文字放窗口内必然遮住 arc → 气泡改为独立透明小窗：
// 置顶、无边框、点击穿透（不挡鼠标/拖拽），显示在桌宠窗口左侧或右侧（按朝向），完全不遮 arc
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const BW = 340; // 气泡窗口固定尺寸（字号不随桌宠缩放，稳定可读）
const BH = 150;

let bubble = null;
let petWinGetter = null;
let hideTimer = null;

function getBubble() {
  if (bubble && !bubble.isDestroyed()) return bubble;
  bubble = new BrowserWindow({
    width: BW, height: BH,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'bubble-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  bubble.loadFile(path.join(__dirname, '..', 'renderer', 'bubble.html'));
  bubble.setAlwaysOnTop(true, 'screen-saver');
  // 点击穿透 + forward：鼠标事件原样传给下方窗口（桌宠拖拽/走动不受气泡遮挡影响）
  bubble.setIgnoreMouseEvents(true, { forward: true });
  bubble.on('closed', () => { bubble = null; });
  return bubble;
}

// 定位：桌宠窗口左/右侧（facing≥0 → 右侧；<0 → 左侧），垂直对齐桌宠上部约 1/5 处，并夹在屏幕工作区内
function placeBubble(facing) {
  const b = getBubble();
  const pet = petWinGetter ? petWinGetter() : null;
  if (!pet || pet.isDestroyed()) return;
  const pb = pet.getBounds();
  const wa = screen.getDisplayMatching(pb).workArea;
  const gap = 8;
  let x, y;
  if (facing >= 0) x = pb.x + pb.width + gap;
  else x = pb.x - BW - gap;
  y = pb.y + Math.round(pb.height * 0.18);
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - BW - 4));
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - BH - 4));
  b.setBounds({ x, y, width: BW, height: BH });
}

function showBubble(text, facing) {
  const b = getBubble();
  if (!text) { hideBubble(); return; }
  // 若正在播淡出等待隐藏：取消，避免刚隐藏又被延迟任务关掉
  clearTimeout(hideTimer);
  placeBubble(typeof facing === 'number' ? facing : 1);
  b.webContents.send('bubble-text', String(text));
  if (!b.isVisible()) b.showInactive();
}

function hideBubble() {
  if (!bubble || bubble.isDestroyed() || !bubble.isVisible()) return;
  // 先让渲染层播"缩小淡出"动画，再延迟真正隐藏窗口（渲染层动画约 0.2s）
  try { bubble.webContents.send('bubble-fadeout'); } catch (e) {}
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (bubble && !bubble.isDestroyed()) bubble.hide();
  }, 210);
}

function registerBubbleIpc(getWinFn) {
  petWinGetter = getWinFn;
  ipcMain.on('bubble-show', (_e, text, facing) => showBubble(text, facing));
  ipcMain.on('bubble-hide', () => hideBubble());
}

module.exports = { registerBubbleIpc, showBubble, hideBubble };
