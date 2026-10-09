// 主进程 - 右键菜单模块：自绘 HTML 菜单窗口（美化样式 + 按类型分组），点击后向桌宠渲染层发送 menu-action
const { ipcMain, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { getWin } = require('./window');

let menuWin = null;

// 读取迁移动作注册表（assets/sprite/actions.json，含 cn 中文名 / cat 类别）
function loadActions() {
  try {
    const p = path.join(__dirname, '..', 'assets', 'sprite', 'actions.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
}

// 固定表演动作（基础帧组，顶级平铺展示）
const FIXED_ITEMS = [
  { id: 'thinking', label: '思考' },
  { id: 'backflip', label: '后空翻' },
  { id: 'kick', label: '踢' },
  { id: 'wine', label: '饮酒' },
  { id: 'wine_2', label: '饮酒2' },
  { id: 'smug', label: '得意' },
  { id: 'tongue', label: '吐舌' },
  { id: 'push', label: '推手' },
  { id: 'star', label: '星星眼' },
  { id: 'pose1', label: '比1' },
  { id: 'hide', label: '挡脸' },
  { id: 'pout', label: '撅嘴' },
  { id: 'lie', label: '躺倒' },
];

// 迁移动作分组：标题 + 类别（actions.json 的 cat 字段）
const CATS = [
  { cat: 'move', title: '移动动作' },
  { cat: 'pose', title: '站立姿态' },
  { cat: 'ground', title: '倒地趴卧' },
  { cat: 'jump', title: '跳跃踢腿' },
  { cat: 'show', title: '特效表演' },
  { cat: 'fall', title: '下落' },
];

// 构建菜单数据：固定项 + 按类别分组的迁移动作（组内按编号排序）
function buildMenuData() {
  const acts = loadActions();
  const groups = CATS.map((c) => {
    const items = acts
      .filter((a) => a.cat === c.cat)
      .sort((a, b) => parseInt(a.name.slice(4)) - parseInt(b.name.slice(4)))
      .map((a) => ({ id: a.name, num: a.name.slice(4), label: a.cn || '动作' }));
    return { cat: c.cat, title: c.title, items };
  });
  return { fixed: FIXED_ITEMS, groups };
}

function closeMenu() {
  if (menuWin && !menuWin.isDestroyed()) menuWin.destroy();
  menuWin = null;
}

// 弹出菜单窗口：跟随鼠标位置（防超出工作区），失焦自动关闭
function showMenu() {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  const data = buildMenuData();
  const W = 252;
  const H = 720; // 高度上限；内容超出由渲染层滚动
  const wa = screen.getPrimaryDisplay().workArea;
  const pt = screen.getCursorScreenPoint();
  let x = Math.min(pt.x, wa.x + wa.width - W - 8);
  let y = Math.min(pt.y, wa.y + wa.height - H - 8);
  x = Math.max(wa.x + 4, x);
  y = Math.max(wa.y + 4, y);

  closeMenu();
  menuWin = new BrowserWindow({
    width: W, height: H, x, y,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, focusable: true,
    hasShadow: false, // 阴影由 CSS 绘制
    webPreferences: {
      preload: path.join(__dirname, 'menu-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  menuWin.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html'));
  menuWin.webContents.on('did-finish-load', () => {
    menuWin.webContents.send('menu-data', data);
  });
  menuWin.on('blur', () => closeMenu());
}

function registerMenuIpc() {
  // 渲染层取动作列表（sprite.js 动态注册 act_* 帧组）
  ipcMain.handle('get-actions', () => {
    const acts = loadActions();
    try {
      fs.appendFileSync(path.join(__dirname, '..', 'voice', 'actions.log'),
        `${new Date().toISOString()} get-actions: ${acts.length} 个动作\n`);
    } catch {}
    return acts;
  });

  ipcMain.on('show-context-menu', () => showMenu());

  // 菜单窗口选择动作：转发给桌宠渲染层（menu-action 与旧原生菜单一致）
  ipcMain.on('menu-pick', (_e, action) => {
    const win = getWin();
    closeMenu();
    if (!win || win.isDestroyed()) return;
    if (action === '__quit__') {
      // 退出桌宠：先播放退出动画（act_49 火箭飞出 / act_33 钻地），播完由渲染层发 quit 真正退出；
      // 12 秒兜底：动画播放异常/渲染层无响应时强制退出
      win.webContents.send('start-exit-anim');
      setTimeout(() => {
        if (win && !win.isDestroyed()) require('electron').app.quit();
      }, 12000);
    } else {
      win.webContents.send('menu-action', action);
    }
  });

  // 菜单窗口关闭（点击空白/取消）
  ipcMain.on('menu-close', () => closeMenu());
}

module.exports = { registerMenuIpc };
