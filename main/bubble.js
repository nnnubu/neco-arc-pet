// 主进程 - 独立气泡窗口模块
// 桌宠精灵几乎占满主窗口，文字放窗口内必然遮住 arc → 气泡改为独立透明小窗：
// 置顶、无边框、点击穿透（不挡鼠标/拖拽），显示在桌宠窗口左侧或右侧（按朝向），完全不遮 arc
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const BW = 430; // 气泡窗口宽度（字号可调 12~50px；高度随内容自适应，不裁剪文字）
const BH = 220; // 初始/默认高度

let bubble = null;
let petWinGetter = null;
let hideTimer = null;
let curBH = BH; // 当前实际窗口高度（内容自适应后更新，供重新定位/高度重算使用）

// 点击穿透 + forward：鼠标事件原样传给下方窗口（桌宠拖拽/走动不受气泡遮挡影响）。
// Windows 上穿透状态在窗口 setBounds/resize/show 后可能丢失（命中测试失效 → 气泡变"透明墙"
// 吞掉鼠标，导致 arc 无法点击/拖拽），因此每次窗口几何或显隐变化后都要重新应用。
function passthrough(b) {
  if (!b || b.isDestroyed()) return;
  try { b.setIgnoreMouseEvents(true, { forward: true }); } catch (e) {}
}

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
  passthrough(bubble);
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
  y = Math.max(wa.y + 4, Math.min(y, wa.y + wa.height - curBH - 4));
  b.setBounds({ x, y, width: BW, height: curBH });
  passthrough(b); // 窗口移动后穿透状态可能失效 → 重新应用，防挡 arc
}

// 渲染层内容高度上报：窗口高度动态跟随文本内容（字大/内容多不裁剪），保持窗口中心锚点不动。
// 只升不降：短句不把窗口缩回去（下一条长句显示瞬间窗口已足够大，杜绝"显示时被裁、resize 前已切走"）；
// 高度最多到工作区高-24，超长文本以能显示完整窗口为上限
function resizeBubble(_e, h) {
  const b = getBubble();
  if (!b || b.isDestroyed()) return;
  const wa = screen.getDisplayMatching(b.getBounds()).workArea;
  const want = Math.max(90, Math.round(Number(h) || 0));
  const maxH = Math.max(90, wa.height - 24);
  if (want >= curBH) {
    const nh = Math.min(want, maxH);
    if (nh === curBH) return;
    const old = b.getBounds();
    // 中心锚点不变：高度增减时 y 相应上移/下移（文字位置视觉不动，只扩展/收缩窗口）
    const ny = Math.round(old.y + (curBH - nh) / 2);
    curBH = nh;
    b.setBounds({ x: old.x, y: ny, width: old.width, height: nh });
    passthrough(b); // 调高窗口后穿透状态可能失效 → 重新应用，防挡 arc
  }
  // want < curBH（短句）：不缩回，窗口保持当前高度 —— 长句完整显示优先
}

function showBubble(text, facing) {
  const b = getBubble();
  if (!text) { hideBubble(); return; }
  // 若正在播淡出等待隐藏：取消，避免刚隐藏又被延迟任务关掉
  clearTimeout(hideTimer);
  placeBubble(typeof facing === 'number' ? facing : 1);
  // 气泡字号/文本颜色可配置（TTS 面板"显示设置"）：统一对所有气泡生效；读 tts-config，失败/旧配置用默认
  let fontSize = 16, color = '#ffd166';
  try {
    const tts = require('./voice').readTtsConfig() || {};
    fontSize = Number(tts.bubbleFontSize) || 16;
    if (/^#[0-9a-fA-F]{6}$/.test(String(tts.bubbleColor || ''))) color = String(tts.bubbleColor);
  } catch (e) {}
  // 渲染层"字号动态适应"上限：内容超高时自动缩小字号，保证整段完整显示（工作区高-24 = 气泡窗口最大高度）
  const pet = petWinGetter ? petWinGetter() : null;
  const wa = pet && !pet.isDestroyed() ? screen.getDisplayMatching(pet.getBounds()).workArea : null;
  const maxH = wa ? Math.max(90, wa.height - 24) : 900;
  b.webContents.send('bubble-text', { text: String(text), fontSize, color, maxH });
  // 每次显示前重设一次最高层级置顶：focusable:false 的透明窗口在 Windows 上
  // 与其他窗口交互后 Z 序可能被压低（被网页等窗口盖住），显示时重设最稳
  try { b.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
  if (!b.isVisible()) b.showInactive();
  passthrough(b); // 显示/置顶后穿透状态可能失效 → 重新应用，防挡 arc
}

function hideBubble() {
  if (!bubble || bubble.isDestroyed() || !bubble.isVisible()) return;
  // 先让渲染层播"缩小淡出"动画，再延迟真正隐藏窗口（渲染层动画约 0.2s）
  try { bubble.webContents.send('bubble-fadeout'); } catch (e) {}
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (bubble && !bubble.isDestroyed()) bubble.hide();
    curBH = BH; // 复位默认高度：下次显示按默认尺寸重新定位，避免上次长句撑大的窗口残留
  }, 210);
}

function registerBubbleIpc(getWinFn) {
  petWinGetter = getWinFn;
  ipcMain.on('bubble-show', (_e, text, facing) => showBubble(text, facing));
  ipcMain.on('bubble-hide', () => hideBubble());
  ipcMain.on('bubble-resize', (_e, h) => resizeBubble(_e, h));
}

module.exports = { registerBubbleIpc, showBubble, hideBubble };
