// 主进程 - 总面板：把 对话/翻唱/语音合成/动作/AI设置 五个独立面板整合为一个窗口。
// 方案：一个主窗口（左侧导航 + 右侧内容区），内容区用 WebContentsView 挂载各模块，
//      每个 view 复用原 renderer html + 原 preload，渲染层与 IPC 链路零迁移。
// 各模块主进程 showXxx() 改为 openModule('xxx')；getXxxWin() 返回 view 包装对象
//      （webContents 可直接 send，isDestroyed 反映 view 是否存活）→ sing/voice/lyric 广播链路不变。
const { BrowserWindow, WebContentsView, ipcMain, screen, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { getWin } = require('./window');
const { getAppRoot, resolveVoiceEnv } = require('./paths');

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

  // ── 语音升级（基础包无语音时：拖拽/选择语音扩展包 zip → 解压到程序根 → 自动重启）──
  ipcMain.handle('voice-upgrade-status', () => ({ hasVoice: !!resolveVoiceEnv() }));
  ipcMain.on('voice-upgrade-open', () => ensureUpgradeWin());
  // 卸载语音扩展包：删除语音引擎与环境，保留用户作品（voice/sing_output、voice/tts_output），完成后自动重启
  ipcMain.handle('voice-uninstall', () => startVoiceUninstall());
  ipcMain.on('voice-upgrade-close', () => {
    if (upgradeWin && !upgradeWin.isDestroyed()) upgradeWin.destroy();
  });
  ipcMain.handle('voice-upgrade-pick', async () => {
    const win = upgradeWin && !upgradeWin.isDestroyed() ? upgradeWin : (masterWin && !masterWin.isDestroyed() ? masterWin : null);
    if (!win) return { ok: false };
    const r = await dialog.showOpenDialog(win, {
      title: '选择语音扩展包（.zip）',
      properties: ['openFile'],
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false };
    return { ok: startVoiceUpgrade(r.filePaths[0]) };
  });
  ipcMain.on('voice-upgrade-path', (_e, zipPath) => startVoiceUpgrade(String(zipPath || '')));

// ── 开发者一键打包（仅开发版显示；发行版 app.isPackaged=true 时渲染层不显示按钮）──
ipcMain.handle('app-is-dev', () => !app.isPackaged);
ipcMain.on('dev-build', (_e, kind) => startDevBuild(String(kind || '')));
ipcMain.on('build-win-close', () => { if (buildWin && !buildWin.isDestroyed()) buildWin.close(); });
}

// 打包状态（顶层作用域：进度小窗标题 + 失败日志摘要）
let buildKind = '';   // 当前打包类型（basic/voice）
let buildErr = '';    // 构建失败时收集 stderr 关键内容

function startDevBuild(kind) {
  const script = path.join(__dirname, '..', 'scripts', kind === 'voice' ? 'build-voice.js' : 'build-basic.js');
  if (!fs.existsSync(script)) return;
  buildKind = kind;
  buildErr = '';
  ensureBuildWin();
  broadcastDevBuild({ t: kind === 'voice' ? '正在打包语音扩展包…' : '开始构建基础包…', kind, pct: 2 });
  const child = spawn(process.execPath, [script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => parseDevBuild(d, false));
  const errChunks = []; // 原始 Buffer 收集：Windows 下 stderr 可能是 GBK 字节，UTF-8 直接解码会乱码
  child.stderr.on('data', (d) => { errChunks.push(d); });
  child.on('close', (code) => {
    if (code !== 0 && !buildErr && errChunks.length) {
      // 脚本未输出失败 JSON（如意外崩溃）时，从原始 stderr 解码关键行兜底
      try { buildErr = new TextDecoder('gbk').decode(Buffer.concat(errChunks)); } catch (e) { buildErr = ''; }
    }
    if (code !== 0 && !buildErr) broadcastDevBuild({ t: '✗ 打包失败（无输出详情）', err: '' });
    else if (code !== 0) {
      // 从错误缓冲里挑可读的关键行（去 Node 栈噪音）
      const lines = buildErr.split('\n').map((l) => l.trim()).filter((l) => l && !/^\s*at /.test(l));
      const brief = lines.slice(-8).join('\n').slice(0, 900);
      broadcastDevBuild({ t: '✗ 打包失败', err: brief || buildErr.slice(-500) });
    } else {
      broadcastDevBuild({ t: '✓ 打包流程结束', pct: 100 });
    }
  });
}
function parseDevBuild(d, isErr) {
  const text = String(d);
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const j = JSON.parse(s);
      if (j && j.t) broadcastDevBuild({ t: j.t, pct: typeof j.pct === 'number' ? j.pct : undefined });
    } catch (e) { /* 普通日志行忽略 */ }
  }
}
function broadcastDevBuild(s) {
  const targets = [];
  if (masterWin && !masterWin.isDestroyed()) targets.push(masterWin.webContents);
  if (buildWin && !buildWin.isDestroyed()) targets.push(buildWin.webContents);
  for (const wc of targets) { try { wc.send('dev-build-progress', s); } catch (e) {} }
}

// 打包进度小窗（独立 BrowserWindow，与语音升级小窗同款交互：进度条 + 百分比 + 阶段/日志）
let buildWin = null;
function ensureBuildWin() {
  if (buildWin && !buildWin.isDestroyed()) { buildWin.show(); buildWin.focus(); return buildWin; }
  const bw = masterWin && !masterWin.isDestroyed() ? masterWin.getBounds() : null;
  buildWin = new BrowserWindow({
    width: 500,
    height: 400,
    x: bw ? Math.round(bw.x + (bw.width - 500) / 2) : undefined,
    y: bw ? Math.round(bw.y + (bw.height - 400) / 2) : undefined,
    frame: false,
    transparent: false,
    backgroundColor: '#12131f',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'master-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  buildWin.loadFile(path.join(__dirname, '..', 'renderer', 'build.html'));
  buildWin.on('closed', () => { buildWin = null; });
  return buildWin;
}

// 语音升级小窗（独立 BrowserWindow：选框 + 进度条；总面板 HTML 弹窗会被原生 WebContentsView 遮挡，故用独立窗口）
let upgradeWin = null;
function ensureUpgradeWin() {
  if (upgradeWin && !upgradeWin.isDestroyed()) { upgradeWin.show(); upgradeWin.focus(); return upgradeWin; }
  const bw = masterWin && !masterWin.isDestroyed() ? masterWin.getBounds() : null;
  upgradeWin = new BrowserWindow({
    width: 500,
    height: 400,
    x: bw ? Math.round(bw.x + (bw.width - 500) / 2) : undefined,
    y: bw ? Math.round(bw.y + (bw.height - 400) / 2) : undefined,
    frame: false,
    transparent: false,
    backgroundColor: '#12131f',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'master-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  upgradeWin.loadFile(path.join(__dirname, '..', 'renderer', 'upgrade.html'));
  upgradeWin.on('closed', () => { upgradeWin = null; });
  return upgradeWin;
}
// 安装进度广播：升级小窗 + 总面板都收（无论从哪发起）
function broadcastUpgrade(s) {
  const targets = [];
  if (masterWin && !masterWin.isDestroyed()) targets.push(masterWin.webContents);
  if (upgradeWin && !upgradeWin.isDestroyed()) targets.push(upgradeWin.webContents);
  for (const wc of targets) { try { wc.send('voice-upgrade-progress', s); } catch (e) {} }
}

// 解压语音扩展包到程序根并自动重启（tar 为 Windows 10+ 自带，支持 zip；完成后 relaunch 探测到语音包）
// 进度：先取 zip 内条目数作分母，解压期间轮询 voice/ + voice-env310/ 已落地文件数 → 广播 {state,done,total,stage}
let upgrading = false;
let upgradePoll = null;

function walkCount(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? walkCount(p) : 1;
  }
  return n;
}
function countVoiceFiles(root) {
  let n = 0;
  for (const sub of ['voice', 'voice-env310']) {
    const dir = path.join(root, sub);
    try { if (fs.existsSync(dir)) n += walkCount(dir); } catch (e) {}
  }
  return n;
}
function startVoiceUpgrade(zipPath) {
  if (upgrading) return false;
  if (!zipPath || !/\.zip$/i.test(zipPath)) {
    broadcastUpgrade({ state: 'error', error: 'invalid' });
    return false;
  }
  if (resolveVoiceEnv()) {
    broadcastUpgrade({ state: 'error', error: 'already' });
    return false;
  }
  upgrading = true;
  const appRoot = getAppRoot();
  // zip 内条目数（含目录行，作进度分母的近似值，偏保守无碍）
  // 注意：zip 条目 2.5 万+ 时 tar -tf 输出超 1MB，默认 maxBuffer 会截断报错 → 必须调大，否则 total=0 百分比永远不显示
  execFile('tar', ['-tf', zipPath], { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (_err, out) => {
    const total = _err ? 0 : String(out).split('\n').filter((l) => l.trim()).length;
    broadcastUpgrade({ state: 'unpacking', done: 0, total, stage: 1 });
    // 轮询落地文件数 → 进度条 + 阶段（1 脚本 / 2 环境 / 3 收尾）
    if (upgradePoll) clearInterval(upgradePoll);
    upgradePoll = setInterval(() => {
      const done = countVoiceFiles(appRoot);
      let stage = 1;
      if (fs.existsSync(path.join(appRoot, 'voice', 'voice_server.py'))) stage = 2;
      if (fs.existsSync(path.join(appRoot, 'voice-env310', 'Scripts', 'python.exe'))) stage = 3;
      broadcastUpgrade({ state: 'unpacking', done, total, stage });
    }, 400);
    console.log('[voice-upgrade] 解压语音扩展包 ->', appRoot, '(zip 条目', total, ')');
    // 低优先级解压：4GB 级 zip（2.5 万+ 文件）解压很吃磁盘/CPU，start /low 降低对其他进程的影响
    // /b 不新建控制台窗口 + windowsHide 隐藏 cmd 本身，避免弹出命令窗口
    // tar 是 Windows 10+ 自带，支持 zip
    const child = spawn('cmd', ['/c', 'start', '', '/b', '/low', '/wait', 'tar', '-xf', zipPath, '-C', appRoot], { windowsHide: true });
    const killTmr = setTimeout(() => { try { child.kill(); } catch (e) {} }, 15 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(killTmr);
      upgrading = false;
      if (upgradePoll) { clearInterval(upgradePoll); upgradePoll = null; }
      broadcastUpgrade({ state: 'error', error: String(err.message) });
      console.error('[voice-upgrade] 解压启动失败:', err.message);
    });
    child.on('close', (code) => {
      clearTimeout(killTmr);
      upgrading = false;
      if (upgradePoll) { clearInterval(upgradePoll); upgradePoll = null; }
      if (code !== 0) {
        broadcastUpgrade({ state: 'error', error: 'tar 解压退出码 ' + code });
        console.error('[voice-upgrade] 解压失败: 退出码', code);
        return;
      }
      broadcastUpgrade({ state: 'done' });
      // 自动重启：重启后探测到语音包，侧边栏出现翻唱/语音合成
      const { app } = require('electron');
      setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
    });
  });
  return true;
}

// 卸载语音扩展包（发行版/开发版通用）：删 voice-env310 整个目录 + voice 目录内除作品子目录外的内容
// 作品子目录（sing_output/tts_output）保留，避免用户已生成的翻唱/语音文件丢失；完成后自动重启回到基础包态
let uninstalling = false;
async function startVoiceUninstall() {
  if (uninstalling) return false;
  const env = resolveVoiceEnv();
  if (!env) { broadcastUpgrade({ state: 'error', error: 'not-installed' }); return false; }
  uninstalling = true;
  broadcastUpgrade({ state: 'uninstalling' });
  const { app } = require('electron');
  const appRoot = env.appRoot;
  const keep = new Set(['sing_output', 'tts_output']);
  try {
    // 1) 先停语音服务与翻唱进程——voice-env310 的 python.exe 正在运行会锁住目录，
    //    直接删除必然 EPERM（Permission denied），且错误消息里的路径还会出现编码乱码
    const voice = require('./voice');
    const sing = require('./sing');
    await voice.stopVoiceServer();
    await sing.stopSing();
    await new Promise((r) => setTimeout(r, 600)); // 等句柄彻底释放
    // 2) 删 Python 环境（大目录，用异步删除避免同步阻塞主进程 UI）
    await fs.promises.rm(path.join(appRoot, 'voice-env310'), { recursive: true, force: true });
    // 3) 删 voice 目录内除作品子目录外的引擎文件/目录（voice_server.py、models、cache、日志等）
    const voiceDir = path.join(appRoot, 'voice');
    if (fs.existsSync(voiceDir)) {
      for (const e of await fs.promises.readdir(voiceDir, { withFileTypes: true })) {
        if (keep.has(e.name)) continue;
        await fs.promises.rm(path.join(voiceDir, e.name), { recursive: true, force: true });
      }
    }
    uninstalling = false;
    broadcastUpgrade({ state: 'uninstalled' });
    console.log('[voice-uninstall] 已卸载语音扩展包:', appRoot);
    setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
  } catch (e) {
    uninstalling = false;
    console.error('[voice-uninstall] 卸载失败:', e.message);
    // EPERM/EBUSY：文件被占用（还有进程没退干净）——给友好提示，不展示可能乱码的原始路径
    const m = String(e.message || '');
    const locked = /EPERM|EBUSY|EACCES/.test(m);
    broadcastUpgrade({ state: 'error', error: locked ? 'locked' : m });
  }
  return true;
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
