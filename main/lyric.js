// 主进程 - 歌词模块：lrc 解析（本地同名 .lrc 优先）+ 网易云联网兜底 + 桌面歌词窗口
// 桌面歌词窗口：置顶透明可拖动，当前句高亮；播放结束自动隐藏
const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getWin } = require('./window');
const { getVoiceRoot, resolveVoiceEnv } = require('./paths');
// getSingPanelWin 在 sing-panel.js（本模块被 sing.js 引用，sing-panel 也被 sing.js 引用；
// 为避免加载期循环依赖，这里不顶层 require，sing-state 回调里运行时 require——届时模块已完整）
function getSingPanelWin() {
  return require('./sing-panel').getSingPanelWin();
}
// getChatWin 同理：chat.js 顶层引 sing-panel，sing-panel 顶层引本模块——回调运行时 require 防循环
function getChatWin() {
  return require('./chat').getChatWin();
}

let lyricWin = null;
let lyricScale = 1; // 歌词窗口缩放（滚轮调节，持久到下次播放）
let lastLyrics = null;   // 最近一次显示的歌词（翻唱面板"显示歌词"重开用）
let lastTitle = '';
let lyricHoverTimer = null; // 鼠标悬停轮询（控件显隐驱动）

// ── 鼠标悬停轮询（控件显隐）──
// 不依赖渲染层 Chromium 鼠标事件：透传(setIgnoreMouseEvents)切换会让渲染层 mouseout/mouseleave 状态错乱
// （锁定→解锁后控件常显）。由主进程用系统光标位置 + 窗口边界判定鼠标是否在窗口内，定时推给渲染层。
function startLyricHoverPoll() {
  if (lyricHoverTimer) return;
  lyricHoverTimer = setInterval(() => {
    if (!lyricWin || lyricWin.isDestroyed() || !lyricWin.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = lyricWin.getBounds();
    const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    lyricWin.webContents.send('lyric-hover', inside);
  }, 150);
}

// ── lrc 解析：[mm:ss.xx] / [mm:ss:xx] 格式 → [{time, text}]（按时间排序）──
function parseLrc(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const out = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    const times = [...line.matchAll(re)];
    if (!times.length) continue;
    const content = line.replace(re, '').trim();
    if (!content) continue;
    for (const m of times) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseFloat('0.' + m[3].padEnd(3, '0')) : 0;
      out.push({ time: min * 60 + sec + frac, text: content });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ── 本地歌词：歌曲同目录同名 .lrc ──
function localLrc(songPath) {
  const dir = path.dirname(songPath);
  // trim：文件名末尾空格（Windows 会自动剔除）若保留会导致同名 .lrc 匹配不上
  const base = path.basename(songPath, path.extname(songPath)).trim();
  for (const ext of ['.lrc', '.LRC']) {
    const p = path.join(dir, base + ext);
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
    }
  }
  return null;
}

// ── 网易云搜索单个歌名：搜索接口 → song id → lrc 歌词（8 秒超时，失败返回 null）──
async function searchOnlineLyrics(q) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const searchUrl = 'https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=3&s='
      + encodeURIComponent(q);
    // 用 Node 全局 fetch（undici）：不跟随 Windows 系统代理（Clash 残留会导致挂起），天然直连
    const r = await fetch(searchUrl, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const song = j && j.result && j.result.songs && j.result.songs[0];
    if (!song || !song.id) return null;
    const lUrl = 'https://music.163.com/api/song/lyric?id=' + song.id + '&lv=1&kv=1&tv=-1';
    const lr = await fetch(lUrl, { signal: ctrl.signal });
    if (!lr.ok) return null;
    const lj = await lr.json();
    const lyric = lj && lj.lrc && lj.lrc.lyric;
    if (lyric) return { lyric, title: song.name };
    return null;
  } catch (e) {
    return null; // 超时/网络失败：静默
  } finally {
    clearTimeout(timer);
  }
}

// 歌名候选：完整名（含"歌手 - "前缀）、去掉歌手前缀（周杰伦 - 晴天 → 晴天）
function titleCandidates(name) {
  const n = String(name || '').trim(); // 防末尾空格（Windows 剔除后本地/在线名不一致）
  return [...new Set([n, n.replace(/^[^\-\u4e00-\u9fff]+\s*-\s*/, '')])].filter(Boolean);
}

// ── 网易云联网兜底（按文件路径歌名）──
async function onlineLyrics(songPath) {
  const name = path.basename(songPath, path.extname(songPath)).trim();
  for (const q of titleCandidates(name)) {
    const got = await searchOnlineLyrics(q);
    if (got) return got;
  }
  return null;
}

// ── 按歌名联网搜歌词（菜单「翻唱历史」播放用——翻唱文件名带"猫姬翻唱"后缀搜不到）──
async function getLyricsByTitle(title) {
  if (!title) return null;
  for (const q of titleCandidates(title)) {
    const got = await searchOnlineLyrics(q);
    if (got) {
      const parsed = parseLrc(got.lyric);
      if (parsed.length) return { lyrics: parsed, title: got.title, source: 'online' };
    }
  }
  return null;
}

// ── 对外：取歌词（本地 lrc 优先 → 网易云联网兜底）；无歌词返回 null ──
async function getLyrics(songPath) {
  if (!songPath || !fs.existsSync(songPath)) return null;
  const local = localLrc(songPath);
  if (local) {
    const parsed = parseLrc(local);
    if (parsed.length) {
      return { lyrics: parsed, title: path.basename(songPath, path.extname(songPath)).trim(), source: 'local' };
    }
  }
  try {
    const online = await onlineLyrics(songPath);
    if (online && online.lyric) {
      const parsed = parseLrc(online.lyric);
      if (parsed.length) return { lyrics: parsed, title: online.title, source: 'online' };
    }
  } catch (e) {}
  return null;
}

// ── 桌面歌词窗口 ──
// 歌词文本颜色可配置（TTS 面板"显示设置"→歌词文本颜色，默认当前亮黄 #ffd04d）：随数据下发，渲染层生成卡拉OK渐变
function getLyricColor() {
  try {
    const tts = require('./voice').readTtsConfig() || {};
    if (/^#[0-9a-fA-F]{6}$/.test(String(tts.lyricColor || ''))) return String(tts.lyricColor);
  } catch (e) {}
  return '#ffd04d';
}
function showLyricWindow(lyrics, title) {
  // 允许空数组：渲染层显示"暂无歌词"占位；null 才忽略
  if (lyrics == null) return;
  // 缓存最近歌词（翻唱面板"显示歌词"重开入口用）
  lastLyrics = lyrics;
  lastTitle = title || '';
  const payload = { lyrics, title, color: getLyricColor() };
  if (!lyricWin || lyricWin.isDestroyed()) {
    const wa = screen.getPrimaryDisplay().workArea;
    const W = 680, H = 130;
    lyricWin = new BrowserWindow({
      width: W, height: H,
      x: Math.round(wa.x + (wa.width - W) / 2),
      y: Math.round(wa.y + wa.height - H - 30),
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, hasShadow: false,
      focusable: false, // 不抢桌宠焦点
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'lyric-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // 层级用 floating（低于桌宠的 screen-saver）：两个窗口同为 screen-saver 时按显示先后排 Z 序，
    // 歌词窗口后显示会压到桌宠上面，鼠标点击被歌词窗口拦截 → "arc 跑到歌词上后点不到拖不动"。
    // floating 仍高于普通应用窗口（歌词照常可见），但桌宠永远在歌词之上，arc 始终可点可拖。
    lyricWin.setAlwaysOnTop(true, 'floating');
    lyricWin.loadFile(path.join(__dirname, '..', 'renderer', 'lyric.html'));
    startLyricHoverPoll(); // 控件显隐轮询（系统光标位置判定，不依赖 Chromium 鼠标事件）
    // loadFile 异步：必须等渲染层加载完成再发歌词数据，否则首帧数据丢失
    lyricWin.webContents.once('did-finish-load', () => {
      if (lyricWin && !lyricWin.isDestroyed()) {
        lyricWin.webContents.send('lyric-data', payload);
      }
    });
    lyricWin.on('closed', () => { lyricWin = null; });
  } else {
    lyricWin.show();
    lyricWin.webContents.send('lyric-data', payload);
  }
}

// ── 扫描翻唱历史（voice/sing_output 子目录 → 歌名 + 完整版/人声轨路径）──
function scanSingHistory() {
  const dir = path.join(getVoiceRoot(), 'sing_output');
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const sub = path.join(dir, d.name);
        let full = null, vocal = null;
        try {
          const files = fs.readdirSync(sub);
          const f = files.find((x) => x.endsWith('_猫姬翻唱.wav'));
          const v = files.find((x) => x === 'neco_vocal_g.wav');
          if (f) full = path.join(sub, f);
          if (v) vocal = path.join(sub, v);
        } catch (e) {}
        return { name: d.name, dir: sub, full, vocal };
      })
      .filter((x) => x.full)
      .sort((a, b) => (a.dir < b.dir ? 1 : -1)); // 最新在前（目录名含歌名，按名倒序近似）
  } catch (e) {
    return [];
  }
}

function registerLyricIpc() {
  // 当前播放的翻唱歌名（渲染层播放时上报，用于歌词窗"下一首"）
  let lastSingName = null;
  ipcMain.on('sing-now', (_e, name) => { lastSingName = name || null; });

  // 歌词窗：进度条拖动 seek → 桌宠渲染层设置 singAudio.currentTime
  ipcMain.on('lyric-seek', (_e, t) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('sing-seek', t);
  });
  // 歌词窗：播放/暂停 → 复用桌宠渲染层 toggleSing
  ipcMain.on('lyric-toggle', () => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('sing-toggle');
  });
  // 歌词窗：下一首/上一首（翻唱历史列表顺序；环绕）
  // 用 sing.js 的 broadcast 发播放指令：桌宠窗播 + 翻唱面板/对话窗同步歌名（仅发桌宠窗会导致面板歌名不更新）
  function singNeighbor(delta) {
    const list = scanSingHistory();
    if (!list.length) return;
    const idx = lastSingName ? list.findIndex((x) => x.name === lastSingName) : -1;
    if (idx < 0) return;
    const n = list.length;
    const target = list[((idx + delta) % n + n) % n];
    const win = getWin();
    if (win && !win.isDestroyed() && target && target.full) {
      require('./sing').broadcast('sing-play', { full: target.full, vocal: null, name: target.name, dir: target.dir });
      // 歌词来源：面板自定义 .lrc（消费逻辑：绑定目标歌才用；绑定其他歌自动清空+面板取消勾选）→ 否则原歌名联网兜底
      const lrc = require('./sing-panel').consumePanelLrc(target.name);
      if (lrc && lrc.path) {
        try {
          const text = fs.readFileSync(lrc.path, 'utf8');
          const parsed = parseLrc(text);
          if (parsed.length) {
            win.webContents.send('sing-lyric', { lyrics: parsed, title: target.name, source: 'custom' });
            return;
          }
        } catch (e) {}
      }
      getLyricsByTitle(target.name).then((lyr) => {
        if (win && !win.isDestroyed()) {
          if (lyr && lyr.lyrics && lyr.lyrics.length) {
            win.webContents.send('sing-lyric', lyr);
          } else {
            // 本地无 .lrc 且联网搜不到 → 桌面歌词显示"暂无歌词"占位
            win.webContents.send('sing-lyric', { lyrics: [], title: target.name, source: 'none' });
          }
        }
      }).catch(() => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('sing-lyric', { lyrics: [], title: target.name, source: 'none' });
        }
      });
    }
  }
  ipcMain.on('lyric-next', () => singNeighbor(1));
  ipcMain.on('lyric-prev', () => singNeighbor(-1));
  // 渲染层翻唱播放完毕 → 自动播放下一首（TTS 播放不在翻唱历史，findIndex 找不到自然 return，不会误切）
  ipcMain.on('sing-auto-next', () => singNeighbor(1));
  // 重开桌面歌词窗口（面板「显示歌词」入口用；无缓存返回 false）
  ipcMain.handle('lyric-reopen', () => reopenLyric());
  // 渲染层：显示歌词窗口（翻唱播放开始）
  ipcMain.on('lyric-show', (_e, data) => {
    showLyricWindow(data && data.lyrics, data && data.title);
  });
  // 渲染层：滚轮缩放歌词（deltaY<0 放大 / >0 缩小；窗口+字号等比，与桌宠滚轮缩放一致）
  ipcMain.on('lyric-resize', (_e, deltaY) => {
    if (!lyricWin || lyricWin.isDestroyed()) return;
    lyricScale = Math.max(0.7, Math.min(2.5, lyricScale + (deltaY < 0 ? 0.1 : -0.1)));
    // 缩放保持窗口中心不变（用户拖动过窗口后缩放不跳位）
    const cur = lyricWin.getBounds();
    const W = Math.round(680 * lyricScale), H = Math.round(130 * lyricScale);
    const x = cur.x + Math.round((cur.width - W) / 2);
    const y = cur.y + Math.round((cur.height - H) / 2);
    lyricWin.setBounds({ x, y, width: W, height: H });
    lyricWin.webContents.send('lyric-scale', lyricScale);
  });
  // 渲染层 JS 拖动歌词窗口（替代 app-region:drag，右键/滚轮不再被系统层吞掉）
  let lyricDrag = null;
  ipcMain.on('lyric-drag-start', (_e, p) => {
    if (!lyricWin || lyricWin.isDestroyed()) return;
    const b = lyricWin.getBounds();
    lyricDrag = { offX: p.sx - b.x, offY: p.sy - b.y };
  });
  ipcMain.on('lyric-drag-move', (_e, p) => {
    if (!lyricDrag || !lyricWin || lyricWin.isDestroyed()) return;
    lyricWin.setPosition(Math.round(p.sx - lyricDrag.offX), Math.round(p.sy - lyricDrag.offY));
  });
  ipcMain.on('lyric-drag-end', () => { lyricDrag = null; });
  // 鼠标透传（类桌宠）：歌词文字区默认穿透下层不挡鼠标，hover 到控件/留白恢复拦截可交互。
  // forward:true 保证穿透时渲染层仍能收到 mousemove，用于 hover 判定。
  // 注意 API 名是 setIgnoreMouseEvents（早期误写 setIgnoreMouse 导致 TypeError、透传从未生效）
  ipcMain.on('lyric-ignore-mouse', (_e, ig) => {
    if (!lyricWin || lyricWin.isDestroyed()) return;
    lyricWin.setIgnoreMouseEvents(!!ig, { forward: true });
  });
  // 渲染层：更新当前句索引（audio timeupdate 驱动）
  ipcMain.on('lyric-update', (_e, index) => {
    if (lyricWin && !lyricWin.isDestroyed()) lyricWin.webContents.send('lyric-idx', index);
  });
  // 渲染层：句内播放进度（每帧 rAF 驱动）→ 歌词窗卡拉OK式颜色渐变（已唱/未唱分界跟随进度）
  ipcMain.on('lyric-progress', (_e, p) => {
    if (lyricWin && !lyricWin.isDestroyed()) lyricWin.webContents.send('lyric-progress', p);
  });
  // 渲染层：隐藏歌词窗口（播放结束/被打断）
  ipcMain.on('lyric-hide', () => {
    if (lyricWin && !lyricWin.isDestroyed()) lyricWin.hide();
  });

  // 翻唱播放状态（桌宠渲染层广播）→ 回显歌词窗口/翻唱面板/对话窗（对话窗标题栏+播放行按钮）
  ipcMain.on('sing-state', (_e, s) => {
    if (lyricWin && !lyricWin.isDestroyed()) lyricWin.webContents.send('lyric-state', s);
    const panel = getSingPanelWin();
    if (panel && !panel.isDestroyed()) panel.webContents.send('sing-panel-state', s);
    const chat = getChatWin();
    if (chat && !chat.isDestroyed()) chat.webContents.send('sing-state', s);
  });

  // 主进程取歌词（sing-done 时 / 菜单历史播放时）
  ipcMain.handle('get-lyrics', async (_e, songPath) => getLyrics(songPath));

  // 打开翻唱文件夹（shell 打开资源管理器）
  ipcMain.on('open-sing-dir', (_e, dir) => {
    if (dir && fs.existsSync(dir)) shell.openPath(String(dir));
  });

  // 渲染层查询翻唱历史（菜单构建用）
  ipcMain.handle('get-sing-history', () => scanSingHistory());
}

// 重开桌面歌词窗口（面板「显示歌词」入口用；无缓存返回 false）
function reopenLyric() {
  if (lastLyrics && lastLyrics.length) {
    showLyricWindow(lastLyrics, lastTitle);
    return true;
  }
  return false;
}

module.exports = { registerLyricIpc, getLyrics, getLyricsByTitle, scanSingHistory, parseLrc, reopenLyric };
