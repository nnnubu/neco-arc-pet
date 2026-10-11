// 主进程 - TTS 文本转语音面板模块（整合进总面板）：输入文本 → 生成语音 → 持久保存到 voice/tts_output/
// 播放复用翻唱播放链路（singAudio + 桌面歌词窗口），歌词 = 文本按句切分 + 按时长估算时间轴
// 音色参数（f0 音高偏移 / index_rate 索引强度 / emotion）可在面板随时切换，持久化 assets/tts-config.json
// 总面板方案：作为 WebContentsView 挂载在主窗口内容区，渲染层/Preload/IPC 完全复用
const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getWin } = require('./window');
const { generateTts } = require('./voice');
const { broadcast } = require('./sing');
const { openModule, hideMaster, minimizeMaster, getViewWebContents } = require('./master-panel');

let generating = false; // 防重入：一次只生成一段

const TTS_DIR = path.join(__dirname, '..', 'voice', 'tts_output');
const CONFIG_PATH = path.join(__dirname, '..', 'assets', 'tts-config.json');
const DEFAULT_CONFIG = { emotion: 'neutral', f0: 0, indexRate: 0.75, intensity: 1, voice: '', valence: 0, arousal: 50, applyToChat: false, applyToSing: false, meowClips: true, bubbleFontSize: 16, bubbleColor: '#ffd166', lyricColor: '#ffd04d' };

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Object.assign({}, DEFAULT_CONFIG, {
      emotion: c.emotion || 'neutral',
      f0: c.f0 != null ? Number(c.f0) : 0,
      indexRate: c.indexRate != null ? Number(c.indexRate) : 0.75,
      intensity: c.intensity != null ? Number(c.intensity) : 1,
      voice: String(c.voice || ''),
      valence: c.valence != null ? Number(c.valence) : 0,
      arousal: c.arousal != null ? Number(c.arousal) : 50,
      applyToChat: !!c.applyToChat,
      applyToSing: !!c.applyToSing,
      meowClips: c.meowClips !== false, // 口癖原版音频开关：默认 true=映射拼接；false=直接朗读
      bubbleFontSize: c.bubbleFontSize != null ? Number(c.bubbleFontSize) : 16, // 气泡字号（桌面歌词已弃用，文本用 arc 旁气泡逐句显示）
      bubbleColor: /^#[0-9a-fA-F]{6}$/.test(String(c.bubbleColor || '')) ? String(c.bubbleColor) : '#ffd166', // 气泡文本颜色（默认当前金→珊瑚渐变主色）
      lyricColor: /^#[0-9a-fA-F]{6}$/.test(String(c.lyricColor || '')) ? String(c.lyricColor) : '#ffd04d',   // 桌面歌词已唱主色（默认当前亮黄）
    });
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(c) {
  const next = Object.assign({}, DEFAULT_CONFIG, {
    emotion: (c && c.emotion) || 'neutral',
    f0: c && c.f0 != null ? Number(c.f0) : 0,
    indexRate: c && c.indexRate != null ? Number(c.indexRate) : 0.75,
    intensity: c && c.intensity != null ? Number(c.intensity) : 1,
    voice: String((c && c.voice) || ''),
    valence: c && c.valence != null ? Number(c.valence) : 0,
    arousal: c && c.arousal != null ? Number(c.arousal) : 50,
    applyToChat: !!(c && c.applyToChat),
    applyToSing: !!(c && c.applyToSing),
    meowClips: c ? c.meowClips !== false : true,
    bubbleFontSize: c && c.bubbleFontSize != null ? Number(c.bubbleFontSize) : 16,
    bubbleColor: /^#[0-9a-fA-F]{6}$/.test(String((c && c.bubbleColor) || '')) ? String(c.bubbleColor) : '#ffd166',
    lyricColor: /^#[0-9a-fA-F]{6}$/.test(String((c && c.lyricColor) || '')) ? String(c.lyricColor) : '#ffd04d',
  });
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {}
  return next;
}

// ── 文本 → 伪歌词：按句读切分，时间按字符占比×总时长估算（TTS 无逐字时间轴）──
function textToLyrics(text, durSec) {
  const s = String(text || '').replace(/\r/g, '').trim();
  if (!s) return [];
  // 按中文句读标点 + 换行切句；短句合并，过长单句按逗号再拆
  const raw = s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const lines = [];
  for (const l of raw) {
    const segs = l.split(/(?<=[。！？!?；;…])/).map((x) => x.trim()).filter(Boolean);
    if (segs.length <= 1) { lines.push(l); continue; }
    // 拆出的段过短（<2字）则并入前段，避免零碎
    for (const g of segs) {
      if (lines.length && g.length < 2) lines[lines.length - 1] += g;
      else lines.push(g);
    }
  }
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  const dur = Number(durSec) || 0;
  let acc = 0;
  return lines.map((l) => {
    const t = Math.round((dur * acc) / total * 100) / 100;
    acc += l.length;
    return { time: t, text: l };
  });
}

// ── 历史：扫描 tts_output/*.wav（含同名 .txt 存文本），最新在前 ──
function scanTtsHistory() {
  try {
    if (!fs.existsSync(TTS_DIR)) return [];
    return fs.readdirSync(TTS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.wav'))
      .map((f) => {
        const p = path.join(TTS_DIR, f);
        let text = '';
        try {
          const tp = p.replace(/\.wav$/i, '.txt');
          if (fs.existsSync(tp)) text = fs.readFileSync(tp, 'utf8');
        } catch (e) {}
        return { name: f, full: p, text };
      })
      .sort((a, b) => (fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs));
  } catch (e) {
    return [];
  }
}

// ── 播放（生成后自动播放 / 历史点击）：走翻唱播放链路 + 桌面歌词（文本即歌词）──
function playTts(full, name, text, dur) {
  const win = getWin();
  if (!win || win.isDestroyed() || !full) return;
  broadcast('sing-play', { full, vocal: null, name, dir: TTS_DIR }); // 桌宠窗播放 + 翻唱面板/对话窗同步歌名
  const lyrics = textToLyrics(text, dur);
  if (lyrics.length) {
    win.webContents.send('sing-lyric', { lyrics, title: name, source: 'tts' });
  }
}

// 安全文件名：只留中文/字母/数字/下划线/连字符
function safeName(text) {
  const t = String(text || '').replace(/\s+/g, '').slice(0, 14);
  const clean = t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  return clean || '语音';
}

function showTtsPanel() {
  openModule('tts');
}

function registerTtsPanelIpc() {
  ipcMain.on('tts-panel-open', () => showTtsPanel());
  ipcMain.on('tts-panel-close', () => hideMaster());
  ipcMain.on('tts-panel-minimize', () => minimizeMaster());

  // 播放状态同步：翻唱/语音共用 singAudio 播放器，sing-state 转发到 TTS 面板（按钮 ▶/⏸ 一致）
  ipcMain.on('sing-state', (_e, s) => {
    const wc = getViewWebContents('tts');
    if (wc && !wc.isDestroyed()) wc.send('sing-panel-state', s);
  });

  // 面板打开：回填配置 + 历史
  ipcMain.handle('tts-panel-load', () => {
    try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch (e) {}
    return { config: loadConfig(), history: scanTtsHistory() };
  });

  // 保存参数配置（切换即生效）
  ipcMain.handle('tts-panel-save', (_e, c) => {
    const saved = saveConfig(c);
    return { ok: true, config: saved };
  });

  // 生成：文本 + 参数（f0/indexRate/emotion 取自面板，未传则用已存配置）
  ipcMain.handle('tts-panel-generate', async (_e, text, params) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return { ok: false, error: '桌宠窗口未就绪' };
    if (generating) return { ok: false, error: '正在生成中，请稍候' };
    const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
    if (!t) return { ok: false, error: '请输入要朗读的文本' };
    const cfg = loadConfig();
    const emotion = (params && params.emotion) || cfg.emotion;
    const f0 = params && params.f0 != null ? Number(params.f0) : cfg.f0;
    const indexRate = params && params.indexRate != null ? Number(params.indexRate) : cfg.indexRate;
    const intensity = params && params.intensity != null ? Number(params.intensity) : cfg.intensity;
    const voice = params && params.voice != null ? String(params.voice) : cfg.voice;
    try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch (e) {}
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const base = safeName(t);
    const outPath = path.join(TTS_DIR, `${stamp}_${base}.wav`);
    generating = true;
    try {
      const r = await generateTts(t, { emotion, f0, indexRate, intensity, voice, outPath });
      // 保存文本（历史播放时重建歌词）；生成失败时 r.out 可能仍为缓存路径，但一般已复制成功
      const finalPath = r.out || outPath;
      try { fs.writeFileSync(finalPath.replace(/\.wav$/i, '.txt'), t, 'utf8'); } catch (e) {}
      const name = path.basename(finalPath);
      const dur = r.dur || 0;
      // 通知 TTS 面板（仅本模块）；播放走 sing-play 广播（桌宠窗播 + 翻唱面板/对话窗同步）
      const wc = getViewWebContents('tts');
      if (wc && !wc.isDestroyed()) {
        wc.send('tts-done', { full: finalPath, name, text: t, dur });
      }
      playTts(finalPath, name, t, dur);
      return { ok: true, full: finalPath, name, dur, cached: !!r.cached };
    } catch (e) {
      const wc2 = getViewWebContents('tts');
      if (wc2 && !wc2.isDestroyed()) {
        wc2.send('tts-error', String(e.message || e));
      }
      return { ok: false, error: e.message || String(e) };
    } finally {
      generating = false;
    }
  });

  // 历史播放：读同名 .txt 做歌词（无文本则只播放不显示歌词）
  ipcMain.handle('tts-panel-play', (_e, name) => {
    const hist = scanTtsHistory().find((h) => h.name === name);
    if (!hist || !hist.full || !fs.existsSync(hist.full)) return { ok: false, error: '文件不存在' };
    const dur = 0;
    playTts(hist.full, hist.name, hist.text || '', dur);
    return { ok: true };
  });

  // 打开 TTS 输出文件夹
  ipcMain.on('tts-panel-dir', () => {
    try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch (e) {}
    shell.openPath(TTS_DIR);
  });
}

module.exports = { showTtsPanel, registerTtsPanelIpc, textToLyrics, loadConfig, saveConfig };
