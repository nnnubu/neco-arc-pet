// 主进程 - 语音服务模块：懒启动长驻 Python 服务，stdin/stdout JSON 协议管理
// 协议见 voice/voice_server.py：-> {"id":1,"text":"..."}  <- {"event":"ready"} / {"id":1,"ok":true,"wav":"..."}
// 网络架构（2026-10-09 起）：CosyVoice 请求改由本进程 fetch（Chromium 网络栈可靠）发出，
// Python 只做本地 RVC 变声（voice-env310 加载 RVC 后 winsock 被污染、curl.exe 域名解析故障均不影响）
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getWin } = require('./window');
const { askAI } = require('./ai');

// ── .env 读取（手写解析，与 ai.js 一致）──
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    const k = l.slice(0, i).trim();
    const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !(k in env)) env[k] = v;
  }
  return env;
}
const ENV = loadEnv();
const API_KEY = ENV.LLM_API_KEY || '';
const COSY_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';
// 情绪参数表：与 voice_server.py EMOTION_CFG 保持一致（用户逐版验收）
const EMOTION_CFG = {
  happy:     { voice: 'diana', desc: '开心欢快', gain: 5, post_gain: 3 },
  angry:     { voice: 'bella', desc: '生气',     gain: 0, post_gain: 6 },
  sad:       { voice: 'bella', desc: '悲伤低沉', gain: 5, post_gain: 3 },
  surprised: { voice: 'bella', desc: '震惊惊讶', gain: 5, post_gain: 3 },
  neutral:   { voice: 'bella', desc: '平静自然', gain: 0, post_gain: 0 },
};

// ── 缓存键（与 voice_server.py cache_path 口径完全一致）──
function normalizeKey(text) {
  let out = '';
  for (const ch of String(text)) {
    const o = ch.codePointAt(0);
    if (o === 0x3000) out += ' ';
    else if (o >= 0xFF01 && o <= 0xFF5E) out += String.fromCharCode(o - 0xFEE0);
    else out += ch;
  }
  return out.trim().replace(/\s+/g, ' ');
}
function cachePath(text, emotion) {
  const key = Buffer.from(normalizeKey(text) + '\x00' + emotion, 'utf8');
  return path.join(__dirname, '..', 'voice', 'cache', crypto.createHash('md5').update(key).digest('hex') + '.wav');
}

// ── CosyVoice 合成（Electron fetch，Chromium 网络栈；校验 wav 有效性后写临时文件）──
async function synthCosy(text, emotion) {
  if (!API_KEY) throw new Error('未配置 LLM_API_KEY（项目根 .env）');
  const cfg = EMOTION_CFG[emotion] || EMOTION_CFG.neutral;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: COSY_MODEL,
        voice: `${COSY_MODEL}:${cfg.voice}`,
        input: `请用${cfg.desc}的情感说这句话：<|endofprompt|>${text}`,
        response_format: 'wav',
        sample_rate: 44100,
        gain: cfg.gain,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (resp.status !== 200) {
    const errText = (await resp.text()).slice(0, 200);
    throw new Error(`CosyVoice API ${resp.status}: ${errText}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 100 || buf.toString('latin1', 0, 4) !== 'RIFF') {
    throw new Error('CosyVoice 返回内容异常（非有效 wav）');
  }
  const src = path.join(__dirname, '..', 'voice', 'cache', `_cosy_src_${Date.now()}.wav`);
  fs.writeFileSync(src, buf);
  return src;
}

// ── 情绪标签解析（语音参数映射在 voice_server 侧，此处只传 emotion）──
const EMOTION_ALIAS = {
  '开心': 'happy', '高兴': 'happy', '愉快': 'happy',
  '生气': 'angry', '愤怒': 'angry', '气': 'angry',
  '难过': 'sad', '伤心': 'sad', '委屈': 'sad',
  '惊讶': 'surprised', '吃惊': 'surprised',
  '平静': 'neutral',
};

// 解析情绪标签：任意位置识别【情绪】→ emotion；并全局剥离所有【】标记（防标签被显示/朗读）
function parseEmotion(reply) {
  const s = String(reply);
  let emotion = 'neutral';
  const tags = s.match(/【\s*([^】\s]+)\s*】/g) || [];
  for (const t of tags) {
    const name = t.replace(/[【】\s]/g, '');
    if (EMOTION_ALIAS[name]) { emotion = EMOTION_ALIAS[name]; break; }
  }
  const text = s.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim();
  return { emotion, text };
}

let voiceProc = null;
let voiceReady = false;
let voiceQueue = [];

function ensureVoiceServer() {
  if (voiceProc) return;
  const py = path.join(__dirname, '..', 'voice-env310', 'Scripts', 'python.exe');
  const script = path.join(__dirname, '..', 'voice', 'voice_server.py');
  // stderr 重定向到日志文件：GPU 版加载时日志量大（faiss/RMVPE 等），
  // 若走 stdout 管道且消费不及时会填满 Windows 管道缓冲，把 Python 进程卡死
  const logFile = fs.openSync(path.join(__dirname, '..', 'voice', 'voice_server.log'), 'a');
  // windowsHide: true 防止 python.exe 弹出黑色控制台窗口（抢焦点会触发输入框失焦自动关闭）
  voiceProc = spawn(py, [script], { cwd: path.join(__dirname, '..', 'voice'), stdio: ['pipe', 'pipe', logFile], windowsHide: true });
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
        // 后台预生成常用短语（缓存预热）：说话命中缓存时秒出
        try { voiceProc.stdin.write(JSON.stringify({ id: 'preset', cmd: 'preset' }) + '\n'); } catch {}
        if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('speak-state', { state: 'ready' });
      } else if (msg.event === 'preset_done') {
        // 预生成完成：只记录，不触发播放/状态（避免误报"出错了"）
        console.log('[voice] 预生成完成:', msg.count);
      } else if (msg.ok && msg.wav) {
        if (getWin() && !getWin().isDestroyed()) {
          getWin().webContents.send('play-audio', msg.wav);
          getWin().webContents.send('speak-state', { state: 'done' });
        }
      } else if (msg.ok) {
        // 其他 ok（如 preset started）：无需处理
      } else {
        console.error('[voice] 生成失败:', msg.error);
        if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('speak-state', { state: 'error', error: msg.error });
      }
    }
  });
  voiceProc.on('exit', () => { voiceReady = false; voiceProc = null; });
}

function flushVoiceQueue() {
  while (voiceQueue.length) {
    const req = voiceQueue.shift();
    if (voiceProc) voiceProc.stdin.write(JSON.stringify(req) + '\n');
  }
}

function registerVoiceIpc() {
  ipcMain.on('speak-text', async (_e, text, force) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
    const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
    if (!t) return;
    // 新链路：输入一律先问 AI（Neco Arc 人设）→ 流式 token → 回复文本 → 合成回复语音播放
    win.webContents.send('speak-state', { state: 'ai' }); // 思考中…
    let reply;
    try {
      reply = await askAI(t, {
        force: !!force, // 重试（↻）：绕过 AI 问答缓存重新生成
        onToken: (tok) => {
          if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('ai-token', { text: tok });
        },
      });
    } catch (e) {
      console.error('[ai] 问答失败:', e.message);
      win.webContents.send('speak-state', { state: 'error', error: 'AI 思考失败: ' + e.message });
      return;
    }
    if (!reply) {
      win.webContents.send('speak-state', { state: 'error', error: 'AI 没有回复' });
      return;
    }
    // 解析情绪标签：标签决定语音合成情绪（voice_server 内部映射到 CosyVoice 参数）
    const { emotion, text: speakText } = parseEmotion(reply);
    console.log(`[ai] 情绪=${emotion} 文本=${speakText}`);
    // 回复文本（去标签）给渲染层显示
    if (!win.isDestroyed()) win.webContents.send('ai-reply', { text: speakText });
    // 合成回复语音：Electron fetch 请求 CosyVoice（Chromium 网络栈可靠）→ Python 本地 RVC 变声 → 缓存
    win.webContents.send('speak-state', { state: 'generating' });
    const cp = cachePath(speakText, emotion);
    if (!force && fs.existsSync(cp)) {
      // 缓存命中：直接播放
      win.webContents.send('play-audio', cp.replace(/\\/g, '/'));
      win.webContents.send('speak-state', { state: 'done' });
      return;
    }
    if (force && fs.existsSync(cp)) { try { fs.unlinkSync(cp); } catch (e) {} }
    let src;
    try {
      src = await synthCosy(speakText, emotion);
    } catch (e) {
      console.error('[cosy] CosyVoice 合成失败:', e.message);
      win.webContents.send('speak-state', { state: 'error', error: '语音合成失败: ' + e.message });
      return;
    }
    ensureVoiceServer();
    const req = { id: Date.now(), cmd: 'vc', src, text: speakText, emotion };
    if (force) req.force = true; // 重试：绕过缓存强制重新合成（覆盖旧缓存）
    if (voiceReady && voiceProc) {
      voiceProc.stdin.write(JSON.stringify(req) + '\n');
    } else {
      voiceQueue.push(req); // 模型仍在加载，排队等 READY
    }
  });
}

module.exports = { registerVoiceIpc };
