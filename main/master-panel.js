// 主进程 - 总面板：把 对话/翻唱/语音合成/动作/AI设置 五个独立面板整合为一个窗口。
// 方案：一个主窗口（左侧导航 + 右侧内容区），内容区用 WebContentsView 挂载各模块，
//      每个 view 复用原 renderer html + 原 preload，渲染层与 IPC 链路零迁移。
// 各模块主进程 showXxx() 改为 openModule('xxx')；getXxxWin() 返回 view 包装对象
//      （webContents 可直接 send，isDestroyed 反映 view 是否存活）→ sing/voice/lyric 广播链路不变。
const { BrowserWindow, WebContentsView, ipcMain, screen } = require('electron');
const path = require('path');
const { getWin } = require('./window');

// 模块注册表：html 与 preload 全部复用原面板文件
const MODULES = {
  chat:   { html: 'chat.html',        preload: 'chat-preload.js' },
  sing:   { html: 'sing-panel.html',  preload: 'sing-panel-preload.js' },
  tts:    { html: 'tts-panel.html',   preload: 'tts-panel-preload.js' },
  action: { html: 'action-panel.html', preload: 'action-panel-preload.js' },
  ai:     { html: 'ai-config.html',   preload: 'ai-config-preload.js' },
};
const ORDER = ['chat', 'sing', 'tts', 'action', 'ai'];

// 布局常量：左侧导航列宽度；右侧内容区 = 窗口宽 - 导航宽（无顶部条，各模块自己的标题栏保留在 view 顶部）
const NAV_W = 184;
const W = 980;
const H = 720;

let masterWin = null;
let views = {}; // name -> { view, loaded }
let active = null;
// 真正退出标志：仅"退出桌宠"（总面板退出按钮/托盘退出）置位；
// 平时总面板关闭=隐藏、桌宠窗口常驻，window-all-closed 不应退出进程（托盘可找回）
let quitting = false;

function isQuitting() { return quitting; }

// 退出桌宠：复用既有退出动画链路（渲染层 act_49 火箭飞出/act_33 钻地 → 播完发 quit → app.quit()），
// 12 秒兜底：动画播放异常/渲染层无响应时强制退出
function requestQuit() {
  if (quitting) return;
  quitting = true;
  const win = getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send('start-exit-anim');
    setTimeout(() => {
      if (quitting) require('electron').app.quit();
    }, 12000);
  } else {
    require('electron').app.quit();
  }
}

function getMasterWin() { return masterWin; }

function getViewWebContents(name) {
  const v = views[name];
  return v && v.view ? v.view.webContents : null;
}

// 全部模块 view 的 webContents（i18n 广播用）
function getAllViewContents() {
  return Object.keys(views).map((k) => (views[k].view ? views[k].view.webContents : null)).filter(Boolean);
}

// 包装对象：与旧 BrowserWindow 引用的最小兼容（webContents + isDestroyed）
function wrapView(name) {
  return {
    webContents: getViewWebContents(name),
    isDestroyed: () => !views[name] || !masterWin || masterWin.isDestroyed(),
  };
}

function destroyViews() {
  for (const k of Object.keys(views)) {
    try { views[k].view.webContents.close(); } catch (e) {}
  }
  views = {};
  active = null;
}

function layoutViews() {
  if (!masterWin || masterWin.isDestroyed()) return;
  const [bw, bh] = masterWin.getContentSize();
  const x = NAV_W;
  const y = 0;
  const w = Math.max(320, bw - NAV_W);
  const h = Math.max(400, bh);
  for (const k of Object.keys(views)) {
    views[k].view.setBounds({ x, y, width: w, height: h });
  }
}

function ensureMasterWin() {
  if (masterWin && !masterWin.isDestroyed()) return masterWin;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = Math.max(wa.x + 40, wa.x + Math.round((wa.width - W) / 2));
  const y = Math.max(wa.y + 24, wa.y + Math.round((wa.height - H) / 2));
  masterWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.min(x, wa.x + wa.width - W - 8),
    y: Math.min(y, wa.y + wa.height - H - 8),
    frame: false,
    transparent: false,
    backgroundColor: '#0b0c15',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'arc.ico'), // 总面板任务栏图标也用 arc（替代 electron 默认）
    // 不置顶：桌宠窗口是 screen-saver 最高置顶层级，若总面板也置顶，Windows 按"最近一次激活/置顶"排序，
    // 总面板被点击（切模块/最大化/任何交互）都会把桌宠盖住。总面板取消置顶 → 桌宠天然永远在总面板之上；
    // 总面板被其他应用盖住时可从任务栏/托盘随时调出（不再对桌宠反复 setAlwaysOnTop——该操作会使透明窗口瞬闪）
    alwaysOnTop: false,
    resizable: true,
    minWidth: 760,
    minHeight: 560,
    skipTaskbar: false,
    fullscreenable: false,
    show: true, // 创建即显示，避免菜单点击"没反应"的感知
    webPreferences: {
      preload: path.join(__dirname, 'master-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  masterWin.loadFile(path.join(__dirname, '..', 'renderer', 'master-panel.html'));
  masterWin.on('resize', () => { layoutViews(); pushMaxState(); });
  masterWin.on('closed', () => { destroyViews(); masterWin = null; });
  return masterWin;
}

// 各模块 view 加载后的附加处理（滚动兼容等已由各面板 css 自行承担，此处仅补数据推送）
function ensureView(name) {
  const mod = MODULES[name];
  if (!mod) return null;
  if (views[name] && views[name].view) return views[name].view;
  const win = ensureMasterWin();
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, mod.preload),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  views[name] = { view, loaded: false };
  view.setVisible(false);
  win.contentView.addChildView(view);
  layoutViews();
  view.webContents.loadFile(path.join(__dirname, '..', 'renderer', mod.html));
  view.webContents.once('did-finish-load', () => {
    if (!views[name] || views[name].view !== view) return;
    views[name].loaded = true;
    // 动作面板需要动作列表：原 showActionPanel 在 did-finish-load 后推送，此处等效补发
    // （运行时 require menu 防循环依赖：menu.js 顶层 require 本模块）
    if (name === 'action') {
      try {
        const { buildMenuData } = require('./menu');
        view.webContents.send('action-panel-data', buildMenuData());
      } catch (e) {
        console.error('[master-panel] action 数据推送失败:', e.message);
      }
    }
    // 加载完成后聚焦内容区：避免首次点击被"激活窗口"吞掉（面板要点两次的根因）
    view.webContents.focus();
  });
  return view;
}

// 打开（或切换）到指定模块：懒创建 view，显示目标、隐藏其他
function openModule(name) {
  if (!MODULES[name]) name = 'chat';
  const win = ensureMasterWin();
  if (win.isMinimized()) win.restore();
  const view = ensureView(name);
  if (!view) return;
  for (const k of Object.keys(views)) {
    if (views[k].view) views[k].view.setVisible(k === name);
  }
  active = name;
  layoutViews();
  win.show();
  win.focus();
  if (views[name] && views[name].loaded) view.webContents.focus();
  // 通知导航渲染层高亮当前模块
  try {
    if (win && !win.isDestroyed()) win.webContents.send('master-active', name);
  } catch (e) {}
}

function hideMaster() {
  if (masterWin && !masterWin.isDestroyed()) masterWin.hide();
}

function minimizeMaster() {
  if (masterWin && !masterWin.isDestroyed()) masterWin.minimize();
}

// 最大化/还原切换：frame:false 窗口没有系统按钮，由导航列底部按钮控制
function toggleMaximizeMaster() {
  const w = masterWin;
  if (!w || w.isDestroyed()) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
  pushMaxState();
}
function pushMaxState() {
  if (masterWin && !masterWin.isDestroyed() && masterWin.webContents) {
    masterWin.webContents.send('master-max-state', !!masterWin.isMaximized());
  }
}

function registerMasterPanelIpc() {
  // 导航点击 → 切换模块
  ipcMain.on('master-nav', (_e, name) => openModule(String(name || 'chat')));
  // 右键点击桌宠 → 打开总面板（原右键菜单栏已移除）
  ipcMain.on('master-open', () => openModule('chat'));
  // 总面板最小化 / 最大化 / 关闭（关闭 = 隐藏，保留各 view 状态，再开秒开）
  ipcMain.on('master-minimize', () => minimizeMaster());
  ipcMain.on('master-maximize', () => toggleMaximizeMaster());
  ipcMain.on('master-close', () => hideMaster());
  // 总面板「退出桌宠」：复用退出动画链路（渲染层播完发 quit → app.quit）
  ipcMain.on('master-quit', () => requestQuit());
}

module.exports = {
  openModule,
  hideMaster,
  minimizeMaster,
  getMasterWin,
  getViewWebContents,
  getAllViewContents,
  wrapView,
  registerMasterPanelIpc,
  requestQuit,
  isQuitting,
};
