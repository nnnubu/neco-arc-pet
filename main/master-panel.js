// 主进程 - 总面板：把 对话/翻唱/语音合成/动作/AI设置 五个独立面板整合为一个窗口。
// 方案：一个主窗口（左侧导航 + 右侧内容区），内容区用 WebContentsView 挂载各模块，
//      每个 view 复用原 renderer html + 原 preload，渲染层与 IPC 链路零迁移。
// 各模块主进程 showXxx() 改为 openModule('xxx')；getXxxWin() 返回 view 包装对象
//      （webContents 可直接 send，isDestroyed 反映 view 是否存活）→ sing/voice/lyric 广播链路不变。
const { BrowserWindow, WebContentsView, ipcMain, screen } = require('electron');
const path = require('path');

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

function getMasterWin() { return masterWin; }

function getViewWebContents(name) {
  const v = views[name];
  return v && v.view ? v.view.webContents : null;
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
    resizable: true,
    minWidth: 760,
    minHeight: 560,
    alwaysOnTop: true,
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
  masterWin.on('resize', () => layoutViews());
  masterWin.on('closed', () => { destroyViews(); masterWin = null; });
  return masterWin;
}

// 各模块 view 注入的滚动兼容 CSS（内容超高时整页滚动，footer 吸底）
const SCROLL_CSS = [
  'html, body { overflow-y: auto !important; }',
  '#footer { position: sticky; bottom: 0; background: #0b0c15; z-index: 5; }',
].join('\n');

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
    // 模块自己的标题栏保留在 view 顶部（作为模块功能条）；AI 设置内容超高时滚动兼容
    if (name === 'ai') {
      view.webContents.insertCSS(SCROLL_CSS).catch(() => {});
    }
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

function registerMasterPanelIpc() {
  // 导航点击 → 切换模块
  ipcMain.on('master-nav', (_e, name) => openModule(String(name || 'chat')));
  // 总面板最小化 / 关闭（关闭 = 隐藏，保留各 view 状态，再开秒开）
  ipcMain.on('master-minimize', () => minimizeMaster());
  ipcMain.on('master-close', () => hideMaster());
}

module.exports = {
  openModule,
  hideMaster,
  minimizeMaster,
  getMasterWin,
  getViewWebContents,
  wrapView,
  registerMasterPanelIpc,
};
