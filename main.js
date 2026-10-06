const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// 透明窗口加固：Windows 上硬件加速合成偶发导致透明失效变白底，
// 禁用后透明层走软件合成，稳定可靠（像素动画性能不受影响）
app.disableHardwareAcceleration();

const WIN_W = 440;
const WIN_H = 530;

let win = null;
const dragState = { dragging: false, startMouse: null, startWin: null };
let mouseTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
    Math.round(workArea.x + workArea.width - WIN_W - 40),
    Math.round(workArea.y + workArea.height - WIN_H - 60)
  );

  if (process.env.PET_DEBUG === '1') {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { debug: '1' } });
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

// ---------------- IPC ----------------

ipcMain.on('drag-start', () => {
  if (!win || win.isDestroyed()) return;
  dragState.dragging = true;
  dragState.startMouse = screen.getCursorScreenPoint();
  dragState.startWin = win.getPosition();
});

ipcMain.on('drag-move', () => {
  if (!win || win.isDestroyed() || !dragState.dragging) return;
  const now = screen.getCursorScreenPoint();
  win.setPosition(
    dragState.startWin[0] + now.x - dragState.startMouse.x,
    dragState.startWin[1] + now.y - dragState.startMouse.y
  );
});

ipcMain.on('drag-end', () => {
  dragState.dragging = false;
});

// 走动：按增量移动窗口，并限制在主显示器工作区内
ipcMain.on('move-by', (_e, { dx, dy }) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const b = win.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const nx = clampTo(x + dx, wa.x, wa.x + wa.width - b.width);
  const ny = clampTo(y + dy, wa.y, wa.y + wa.height - b.height);
  win.setPosition(Math.round(nx), Math.round(ny));
  if (process.env.PET_DEBUG === '1') {
    console.log(`[debug] move-by -> (${Math.round(nx)}, ${Math.round(ny)})`);
  }
});

function clampTo(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 鼠标进入窗口时聚焦，便于接收键盘控制
ipcMain.on('focus-window', () => {
  if (!win || win.isDestroyed()) return;
  if (!win.isFocused()) win.focus();
});

ipcMain.on('resize-window', (_e, { width, height }) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: Math.round(width), height: Math.round(height) });
});

// 桌宠缩放：滚轮控制。保持窗口底部位置，水平居中；限制窗口不超出工作区
ipcMain.on('pet-scale', (_e, scale) => {
  if (!win || win.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const maxScale = Math.max(1, Math.min(wa.width / WIN_W, wa.height / WIN_H));
  const s = Math.max(0.5, Math.min(scale, maxScale));
  const w = Math.round(WIN_W * s);
  const h = Math.round(WIN_H * s);
  const b = win.getBounds();
  const nx = clampTo(Math.round(b.x + (b.width - w) / 2), wa.x, wa.x + wa.width - w);
  const ny = clampTo(Math.round(b.y + b.height - h), wa.y, wa.y + wa.height - h);
  console.log(`[scale] req=${scale} applied=${s} bounds=(${nx},${ny},${w},${h})`);
  win.setBounds({ x: nx, y: ny, width: w, height: h });
  console.log(`[scale] after setBounds: bounds=${JSON.stringify(win.getBounds())}`);
  win.webContents.send('pet-scale-applied', s);
});

// 渲染层查询最大缩放倍率（窗口不超出工作区）
ipcMain.handle('pet-get-max-scale', () => {
  const wa = screen.getPrimaryDisplay().workArea;
  return Math.max(1, Math.min(wa.width / WIN_W, wa.height / WIN_H));
});

ipcMain.on('show-context-menu', () => {
  if (!win || win.isDestroyed()) return;
  const send = (name) => win.webContents.send('menu-action', name);
  const template = [
    { label: 'Thinking（思考）', click: () => send('thinking') },
    { label: 'Backflip（后空翻）', click: () => send('backflip') },
    { label: 'Kick（踢）', click: () => send('kick') },
    { label: 'Wine（饮酒）', click: () => send('wine') },
    { label: 'Wine2（饮酒2）', click: () => send('wine_2') },
    { type: 'separator' },
    { label: 'Smug（得意）', click: () => send('smug') },
    { label: 'Tongue（吐舌）', click: () => send('tongue') },
    { label: 'Push（推手）', click: () => send('push') },
    { label: 'Star（星星眼）', click: () => send('star') },
    { label: 'Pose1（比1）', click: () => send('pose1') },
    { label: 'Hide（挡脸）', click: () => send('hide') },
    { label: 'Pout（撇嘴）', click: () => send('pout') },
    { label: 'Lie（躺倒）', click: () => send('lie') },
    { type: 'separator' },
    { label: '说句话…', click: () => send('SPEAK') },
    { type: 'separator' },
    { label: '重置动作', click: () => send('RESET') },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
});

ipcMain.on('quit', () => app.quit());

// 调试：渲染层日志转发
ipcMain.on('debug-log', (_e, msg) => console.log('[renderer]', msg));

// 调试：渲染层请求截图，保存为 debug-<name>.png
ipcMain.on('debug-shot', async (_e, name) => {
  if (!win || win.isDestroyed()) return;
  try {
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync(path.join(__dirname, `debug-${name}.png`), img.toPNG());
    console.log(`[debug] shot saved: ${name}`);
  } catch (e) {
    console.error('[debug] shot failed:', e);
  }
});

// ---------------- 语音（说句话…） ----------------
// 懒启动长驻 Python 服务：首次点"说句话…"才拉起（模型加载约 1 分钟），之后模型常驻、转换约 10-40 秒
let voiceProc = null;
let voiceReady = false;
let voiceQueue = [];

function ensureVoiceServer() {
  if (voiceProc) return;
  const py = path.join(__dirname, 'voice-env310', 'Scripts', 'python.exe');
  const script = path.join(__dirname, 'voice', 'voice_server.py');
  voiceProc = spawn(py, [script], { cwd: path.join(__dirname, 'voice') });
  voiceReady = false;
  let buf = '';
  voiceProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === 'ready') {
        voiceReady = true;
        flushVoiceQueue();
        if (win && !win.isDestroyed()) win.webContents.send('speak-state', { state: 'ready' });
      } else if (msg.ok) {
        if (win && !win.isDestroyed()) {
          win.webContents.send('play-audio', msg.wav);
          win.webContents.send('speak-state', { state: 'done' });
        }
      } else {
        console.error('[voice] 生成失败:', msg.error);
        if (win && !win.isDestroyed()) win.webContents.send('speak-state', { state: 'error', error: msg.error });
      }
    }
  });
  voiceProc.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) console.error('[voice:err]', s);
  });
  voiceProc.on('exit', () => { voiceReady = false; voiceProc = null; });
}

function flushVoiceQueue() {
  while (voiceQueue.length) {
    const req = voiceQueue.shift();
    if (voiceProc) voiceProc.stdin.write(JSON.stringify(req) + '\n');
  }
}

ipcMain.on('speak-text', (_e, text) => {
  if (!win || win.isDestroyed()) return;
  const t = (text || '').trim();
  if (!t) return;
  ensureVoiceServer();
  win.webContents.send('speak-state', { state: 'generating' });
  const req = { id: Date.now(), text: t };
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
});
