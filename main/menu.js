// 主进程 - 右键菜单模块：自绘 HTML 菜单窗口（动作统合一个模块 + 设置模块可配置随机播放），点击后向桌宠渲染层发送 menu-action
const { ipcMain, BrowserWindow, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getWin } = require('./window');
const { scanSingHistory, getLyricsByTitle } = require('./lyric');
const { showSingPanel } = require('./sing-panel');
const { showChat } = require('./chat');
const { broadcast } = require('./sing');

let menuWin = null;

// 用户配置文件（随机播放等参数，用户可在菜单「设置」中调整，持久化）
const CONFIG_PATH = path.join(__dirname, '..', 'assets', 'user-config.json');
const DEFAULT_CONFIG = { randomAction: { enabled: true, intervalSec: 15 } };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const c = JSON.parse(raw);
    return { randomAction: Object.assign({}, DEFAULT_CONFIG.randomAction, (c && c.randomAction) || {}) };
  } catch (e) {
    // 文件缺失/损坏：生成默认配置
    saveConfig(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(c) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), 'utf8');
  } catch (e) {}
}

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

// 构建菜单数据：动作统合一个模块（常用 + 按类别分组）+ 设置模块（随机播放配置）
function buildMenuData() {
  const acts = loadActions();
  const groups = CATS.map((c) => {
    const items = acts
      .filter((a) => a.cat === c.cat)
      .sort((a, b) => parseInt(a.name.slice(4)) - parseInt(b.name.slice(4)))
      .map((a) => ({ id: a.name, num: a.name.slice(4), label: a.cn || '动作' }));
    return { cat: c.cat, title: c.title, items };
  });
  return { fixed: FIXED_ITEMS, groups, config: loadConfig(), singHistory: scanSingHistory() };
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
    } else if (action === 'SING_DIR') {
      // 「打开翻唱文件夹」：资源管理器打开 voice/sing_output
      const dir = path.join(__dirname, '..', 'voice', 'sing_output');
      if (fs.existsSync(dir)) shell.openPath(dir);
    } else if (action === 'SING_PANEL') {
      // 「翻唱面板」：独立窗口（拖拽音频 → 处理 → 播放）
      showSingPanel();
    } else if (action === 'SPEAK') {
      // 「说句话…」：打开对话窗口（独立窗口，不遮桌宠）
      showChat();
    } else if (action === 'AI_CONFIG') {
      // 「AI 设置」：独立面板（密钥/模型/接口/提示词 配置化）
      require('./ai-config').showAiConfig();
    } else if (typeof action === 'string' && action.startsWith('sing:')) {
      // 菜单「翻唱历史」点击某首歌：立即播放（无歌词也能播），歌词搜到后异步补发
      const name = action.slice(5);
      const dir = path.join(__dirname, '..', 'voice', 'sing_output', name);
      try {
        const full = fs.readdirSync(dir).find((f) => f.endsWith('_猫姬翻唱.wav'));
        if (full) {
          const p = path.join(dir, full);
          if (!fs.existsSync(p)) return; // 文件被删/占位：不播
          broadcast('sing-play', { full: p, vocal: null, name, dir });
          getLyricsByTitle(name).then((lyr) => {
            if (win && !win.isDestroyed() && lyr && lyr.lyrics && lyr.lyrics.length) {
              win.webContents.send('sing-lyric', lyr);
            }
          }).catch(() => {});
        }
      } catch (e) {
        // 目录缺失/读取失败：静默
      }
    } else {
      win.webContents.send('menu-action', action);
    }
  });

  // 菜单窗口关闭（点击空白/取消）
  ipcMain.on('menu-close', () => closeMenu());

  // 渲染层（桌宠）读取用户配置（随机播放参数等）
  ipcMain.handle('get-config', () => loadConfig());

  // 菜单「设置」模块修改配置：写文件 + 广播给桌宠渲染层即时生效（无需重启）
  ipcMain.on('menu-config-set', (_e, key, value) => {
    const c = loadConfig();
    if (key === 'randomAction.enabled') c.randomAction.enabled = !!value;
    else if (key === 'randomAction.intervalSec') c.randomAction.intervalSec = Math.max(5, Math.min(120, Math.round(value)));
    saveConfig(c);
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('config-changed', c);
  });
}

module.exports = { registerMenuIpc };
