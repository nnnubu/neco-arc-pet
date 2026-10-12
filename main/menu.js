// 主进程 - 动作/配置模块：动作注册表 + 菜单动作转发 + 用户配置读写。
// 说明：原右键自绘菜单窗口已随"去掉右键菜单栏"移除；菜单入口（动作面板 pick / 趴下站起 / 重置等）
//      统一走 menu-pick 链路，随机表演配置走 get-config / menu-config-set（动作面板设置区复用）。
const { ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getWin } = require('./window');
const { getLyricsByTitle } = require('./lyric');
const { broadcast } = require('./sing');
const { openModule } = require('./master-panel');
const { getAssetRoot, getVoiceRoot } = require('./paths');

// 用户配置文件（随机播放等参数，用户可在菜单「设置」中调整，持久化）
const CONFIG_PATH = path.join(getAssetRoot(), 'user-config.json');
// 随机动作间隔：区间 [minSec, maxSec] 秒内随机取值（原 intervalSec 固定值迁移兼容）
const DEFAULT_CONFIG = { randomAction: { enabled: true, intervalMin: 10, intervalMax: 30, intervalSec: 15 } };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const c = JSON.parse(raw);
    const ra = Object.assign({}, DEFAULT_CONFIG.randomAction, (c && c.randomAction) || {});
    // 兼容旧配置：只有 intervalSec 时展开为 ±5 秒区间
    if (ra.intervalMin == null && ra.intervalMax == null && ra.intervalSec != null) {
      ra.intervalMin = Math.max(5, ra.intervalSec - 5);
      ra.intervalMax = ra.intervalSec + 5;
    }
    return { randomAction: ra };
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
    const p = path.join(getAssetRoot(), 'sprite', 'actions.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
}

// 固定表演动作（基础帧组，顶级平铺展示；num 为面板显示编号，200+ 与 act_* 编号区分）
const FIXED_ITEMS = [
  { id: 'thinking', num: '200', label: '思考' },
  { id: 'backflip', num: '201', label: '后空翻' },
  { id: 'kick', num: '202', label: '踢' },
  { id: 'wine', num: '203', label: '饮酒' },
  { id: 'wine_2', num: '204', label: '饮酒2' },
  { id: 'smug', num: '205', label: '得意' },
  { id: 'tongue', num: '206', label: '吐舌' },
  { id: 'push', num: '207', label: '推手' },
  { id: 'star', num: '208', label: '星星眼' },
  { id: 'pose1', num: '209', label: '比1' },
  { id: 'hide', num: '210', label: '挡脸' },
  { id: 'pout', num: '211', label: '撅嘴' },
  { id: 'lie', num: '212', label: '躺倒' },
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
  return { fixed: FIXED_ITEMS, groups, config: loadConfig() };
}

// 弹出菜单窗口逻辑已随"去掉右键菜单栏"移除：动作选择统一由总面板动作模块走 menu-pick。
function registerMenuIpc() {
  // 渲染层取动作列表（sprite.js 动态注册 act_* 帧组）
  ipcMain.handle('get-actions', () => {
    const acts = loadActions();
    try {
      fs.appendFileSync(path.join(getVoiceRoot(), 'actions.log'),
        `${new Date().toISOString()} get-actions: ${acts.length} 个动作\n`);
    } catch {}
    return acts;
  });

  // 动作面板/功能按钮选择动作：转发给桌宠渲染层（menu-action 与旧菜单一致）
  ipcMain.on('menu-pick', (_e, action) => {
    const win = getWin();
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
      const dir = path.join(getVoiceRoot(), 'sing_output');
      if (fs.existsSync(dir)) shell.openPath(dir);
    } else if (action === 'MASTER') {
      // 「总面板」：统一入口，默认对话模块
      openModule('chat');
    } else if (action === 'SING_PANEL') {
      // 「翻唱面板」：总面板内翻唱模块（拖拽音频 → 处理 → 播放）
      openModule('sing');
    } else if (action === 'SPEAK') {
      // 「说句话…」：总面板内对话模块
      openModule('chat');
    } else if (action === 'ACTION_PANEL') {
      // 「动作面板」：总面板内动作模块（点击动作不关闭，可连续测试）
      openModule('action');
    } else if (action === 'TTS_PANEL') {
      // 「语音面板」：总面板内文本转语音模块
      openModule('tts');
    } else if (action === 'AI_CONFIG') {
      // 「AI 设置」：总面板内 AI 设置模块
      openModule('ai');
    } else if (typeof action === 'string' && action.startsWith('sing:')) {
      // 菜单「翻唱历史」点击某首歌：立即播放（无歌词也能播），歌词搜到后异步补发
      const name = action.slice(5);
      const dir = path.join(getVoiceRoot(), 'sing_output', name);
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

  // 渲染层（桌宠）读取用户配置（随机播放参数等）
  ipcMain.handle('get-config', () => loadConfig());

  // 菜单「设置」模块修改配置：写文件 + 广播给桌宠渲染层即时生效（无需重启）
  ipcMain.on('menu-config-set', (_e, key, value) => {
    const c = loadConfig();
    if (key === 'randomAction.enabled') c.randomAction.enabled = !!value;
    else if (key === 'randomAction.intervalMin') c.randomAction.intervalMin = Math.max(5, Math.min(300, Math.round(value)));
    else if (key === 'randomAction.intervalMax') c.randomAction.intervalMax = Math.max(5, Math.min(300, Math.round(value)));
    saveConfig(c);
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('config-changed', c);
  });
}

module.exports = { registerMenuIpc, buildMenuData };
