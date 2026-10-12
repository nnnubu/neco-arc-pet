// 主进程 - 语音服务模块：懒启动长驻 Python 服务，stdin/stdout JSON 协议管理
// 协议见 voice/voice_server.py：-> {"id":1,"text":"..."}  <- {"event":"ready"} / {"id":1,"ok":true,"wav":"..."}
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');
// chat 模块延迟 require：chat.js → tts-panel.js → voice.js 构成循环依赖，
// 顶层解构会触发 "Accessing non-existent property" 警告；函数内 require 则始终拿到完整导出
const { askAI, getAiConfig } = require('./ai');
const { getAssetRoot, resolveVoiceEnv, getVoiceRoot, noVoiceMsg } = require('./paths');

function chatModule() { return require('./chat'); }

// TTS 面板参数（assets/tts-config.json）：聊天/翻唱"应用到…"开关由此读
const TTS_CONFIG_PATH = path.join(getAssetRoot(), 'tts-config.json');
function readTtsConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(TTS_CONFIG_PATH, 'utf8'));
    return {
      f0: c.f0 != null ? Number(c.f0) : 0,
      indexRate: c.indexRate != null ? Number(c.indexRate) : 0.75,
      intensity: c.intensity != null ? Number(c.intensity) : 1,
      voice: String(c.voice || ''),
      applyToChat: !!c.applyToChat,
      applyToSing: !!c.applyToSing,
      meowClips: c.meowClips !== false, // 口癖原版音频开关：默认 true=遇到口癖用原版音频拼接；false=纯 TTS 直接朗读
      bubbleFontSize: c.bubbleFontSize != null ? Number(c.bubbleFontSize) : 16, // 气泡字号（bubble.js 读取）
      bubbleColor: /^#[0-9a-fA-F]{6}$/.test(String(c.bubbleColor || '')) ? String(c.bubbleColor) : '#ffd166', // 气泡文本颜色
      lyricColor: /^#[0-9a-fA-F]{6}$/.test(String(c.lyricColor || '')) ? String(c.lyricColor) : '#ffd04d',   // 桌面歌词已唱主色
    };
  } catch (e) { return null; }
}

// 对话事件广播：桌宠窗（播放音频/透明文字逐字）+ 对话窗（消息气泡/状态显示）
function broadcast(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  const chat = chatModule().getChatWin();
  if (chat && !chat.isDestroyed()) chat.webContents.send(channel, payload);
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

// ── 主动说话（桌宠定时找用户搭话）──
// activeReqs：跟踪"用户输入/主动搭话"发出去的合成请求，收到对应响应才算说完，
// 避免 preset 预生成的完成事件把播放状态误判为空闲
const activeReqs = new Set();
// TTS 面板请求：独立回调表（id 前缀 'tts-'），响应不走说话播放链路
const ttsCallbacks = new Map();
let proactiveTimer = null;

function isSpeaking() { return activeReqs.size > 0; }

// 重启主动说话定时器（配置保存 / 模块加载时调用；间隔取配置，开关关闭则停）
function restartProactiveTimer() {
  if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
  const cfg = getAiConfig();
  if (!cfg.proactiveEnabled) return;
  const min = Math.max(1, Number(cfg.proactiveIntervalMin) || 30);
  proactiveTimer = setInterval(() => {
    if (isSpeaking() || voicePlaying) return; // 用户正在听/正在合成或播放中，不打扰
    if (singPlaying) return;  // 翻唱播放中：不主动搭话，避免打断用户听歌
    handleProactiveSpeak();
  }, min * 60 * 1000);
}

// 主动搭话最近台词（上限 12 条）：拼进搭话指令，明确要求换新话题/新句式，避免重复
const proactiveHistory = [];
// 翻唱是否播放中：渲染层 sing-state('playing') 事件维护；播放中不主动搭话/随机发声，避免打断听歌
let singPlaying = false;

// ── 随机发声：偶尔用本地语音素材（assets/voice-clips/*.wav）主动叫一声 ──
// 素材播放不依赖语音引擎（渲染层直接播 wav），基础包无语音扩展包也可用
const CLIP_DIR = path.join(getAssetRoot(), 'voice-clips');
let voiceClips = [];
let voiceTimer = null;
// 聊天语音是否正在播放（渲染层上报 voice-playing/voice-done）：
// 播放期间暂停随机发声倒计时，播完才重新计时，避免随机音频叠在聊天语音上
let voicePlaying = false;

function loadVoiceClips() {
  try {
    voiceClips = fs.readdirSync(CLIP_DIR).filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f));
  } catch (e) {
    voiceClips = [];
    console.error('[voice-clips] 素材目录读取失败:', e.message);
  }
  return voiceClips.length;
}

// 单次触发：随机选一个素材播放（严格避开：静音模式/说话中/语音播放中/翻唱播放中）
function fireRandomVoice() {
  const cfg = getAiConfig();
  if (!cfg.randomVoiceEnabled || cfg.muteVoice) return false;
  if (singPlaying || isSpeaking() || voicePlaying) return false;
  if (!voiceClips.length) return false;
  const name = voiceClips[Math.floor(Math.random() * voiceClips.length)];
  const win = getWin();
  if (!win || win.isDestroyed()) return false;
  win.webContents.send('pet-play-clip', { path: path.join(CLIP_DIR, name) });
  console.log('[voice-clips] 随机发声:', name);
  return true;
}

// 重启随机发声定时器：间隔在 [min, max] 分钟内随机取值，触发后重新调度
function restartVoiceTimer() {
  if (voiceTimer) { clearTimeout(voiceTimer); voiceTimer = null; }
  const cfg = getAiConfig();
  if (!cfg.randomVoiceEnabled) return;
  const min = Math.max(0.5, Number(cfg.randomVoiceMin) || 3);
  const max = Math.max(min, Number(cfg.randomVoiceMax) || 8);
  const delay = (min + Math.random() * (max - min)) * 60 * 1000;
  voiceTimer = setTimeout(() => {
    fireRandomVoice();
    restartVoiceTimer();
  }, delay);
}

// 聊天语音开始播放：暂停随机发声倒计时（倒计时作废，等播完重新计时）
function onVoicePlaying() {
  voicePlaying = true;
  if (voiceTimer) { clearTimeout(voiceTimer); voiceTimer = null; }
}

// 聊天语音播放完毕：恢复随机发声计时（从头开始完整间隔）
function onVoiceDone() {
  voicePlaying = false;
  restartVoiceTimer();
}
function buildProactivePrompt(cfg) {
  const base = cfg.proactivePrompt || '主动找人类搭一句话：简短一句，用猫姬人设，直接输出台词不要解释。';
  if (!proactiveHistory.length) return base;
  const recent = proactiveHistory.slice(-6).map((t, i) => `${i + 1}. ${t}`).join('\n');
  return (
    base +
    '\n\n【避免重复】以下是你最近主动说过的台词，请换一个全新的话题和句式，绝对不要重复它们的内容或开头：\n' +
    recent
  );
}

// 主动搭话：以"主动指令"问 AI（force 绕过问答缓存，每次都生成新台词）→ 走标准合成播放
async function handleProactiveSpeak(force = false) {
  const win = getWin();
  if (!win || win.isDestroyed()) return false;
  const cfg = getAiConfig();
  // 定时触发遵守开关；手动点"立即说一句"（force）忽略开关，便于验收
  if (!force && !cfg.proactiveEnabled) return false;
  broadcast('speak-state', { state: 'ai' }); // 思考中…
  let reply;
  try {
    reply = await askAI(buildProactivePrompt(cfg), {
      force: true,
      onToken: (tok) => broadcast('ai-token', { text: tok }),
    });
  } catch (e) {
    console.error('[proactive] 主动搭话 AI 失败:', e.message);
    broadcast('speak-state', { state: 'error', error: '主动说话失败: ' + e.message });
    return false;
  }
  if (!reply) {
    broadcast('speak-state', { state: 'error', error: '主动说话没有回复' });
    return false;
  }
  const { emotion, text: speakText } = parseEmotion(reply);
  console.log(`[proactive] 情绪=${emotion} 文本=${speakText}`);
  chatModule().recordMsg('pet', speakText); // 进对话窗历史（即使对话窗未打开，重开可见）
  proactiveHistory.push(speakText);  if (proactiveHistory.length > 12) proactiveHistory.shift();
  if (!win.isDestroyed()) broadcast('ai-reply', { text: speakText });
  // 翻唱播放中/静音模式：只出文字不播语音（手动点"立即说一句"也走这里；静音不影响翻唱音乐）
  if (singPlaying || getAiConfig().muteVoice) { broadcast('speak-state', { state: 'done' }); return true; }
  broadcast('speak-state', { state: 'generating' });
  // 无语音扩展包：只出文本不合成（基础包降级，不报错打扰用户聊天）——文本仍显示在 arc 旁气泡
  if (!resolveVoiceEnv()) {
    broadcast('bubble-text-only', { text: speakText });
    broadcast('speak-state', { state: 'done' });
    return true;
  }
  ensureVoiceServer();
  const id = Date.now();
  activeReqs.add(id);
  const req = { id, text: speakText, emotion, force: true };
  // TTS 面板"应用到聊天"：主动搭话也跟随面板音色参数（与手动聊天一致）
  const ttsCfg = readTtsConfig();
  if (ttsCfg && ttsCfg.applyToChat) {
    req.f0 = Number(ttsCfg.f0) || 0;
    req.index_rate = ttsCfg.indexRate != null ? Number(ttsCfg.indexRate) : 0.75;
    req.intensity = ttsCfg.intensity != null ? Number(ttsCfg.intensity) : 1;
    req.voice = String(ttsCfg.voice || '');
  }
  // 口癖原版音频开关：全局生效（默认 true=映射拼接；false=直接朗读口癖词）
  if (ttsCfg) req.meow_clips = ttsCfg.meowClips !== false;
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
  return true; // 已生成文本并进入合成链路（合成结果由异步回调反馈到气泡）
}

function ensureVoiceServer() {
  if (voiceProc) return;
  // 语音引擎探测（语音扩展包解压到程序根目录）：找不到 → 广播 no-voice，功能降级（聊天仍出文本）
  const env = resolveVoiceEnv();
  if (!env) {
    broadcast('speak-state', { state: 'no-voice', error: noVoiceMsg() });
    return;
  }
  const py = env.py;
  const script = path.join(env.voiceDir, 'voice_server.py');
  // stderr 重定向到日志文件：GPU 版加载时日志量大（faiss/RMVPE 等），
  // 若走 stdout 管道且消费不及时会填满 Windows 管道缓冲，把 Python 进程卡死
  const logFile = fs.openSync(path.join(env.voiceDir, 'voice_server.log'), 'a');
  // windowsHide: true 防止 python.exe 弹出黑色控制台窗口（抢焦点会触发输入框失焦自动关闭）
  // env 传入 LLM_API_KEY：voice_server 启动时优先读环境变量（打包态无 .env，密钥来自 AI 设置面板）
  const spawnEnv = Object.assign({}, process.env, { LLM_API_KEY: String(getAiConfig().apiKey || '') });
  voiceProc = spawn(py, [script], { cwd: env.voiceDir, stdio: ['pipe', 'pipe', logFile], windowsHide: true, env: spawnEnv });
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
        broadcast('speak-state', { state: 'ready' });
      } else if (msg.event === 'preset_done') {
        // 预生成完成：只记录，不触发播放/状态（避免误报"出错了"）
        console.log('[voice] 预生成完成:', msg.count);
      } else if (msg.id && ttsCallbacks.has(msg.id)) {
        // TTS 面板请求完成/失败：走独立回调（不触发说话播放/状态）
        const cb = ttsCallbacks.get(msg.id);
        ttsCallbacks.delete(msg.id);
        if (cb) {
          if (msg.ok) cb.resolve({ wav: msg.wav, out: msg.out || msg.wav, dur: msg.dur || 0, cached: !!msg.cached });
          else cb.reject(new Error(msg.error || 'TTS 生成失败'));
        }
      } else if (msg.ok && msg.wav) {
        if (activeReqs.has(msg.id)) activeReqs.delete(msg.id);
        // 合成期间用户切到翻唱 / 开了静音：丢弃这条语音，只结束状态，不打断听歌
        if (singPlaying || getAiConfig().muteVoice) {
          broadcast('speak-state', { state: 'done' });
          continue;
        }
        broadcast('play-audio', msg.wav);
        broadcast('speak-state', { state: 'done' });
      } else if (msg.ok) {
        // 其他 ok（如 preset started）：无需处理
      } else {
        console.error('[voice] 生成失败:', msg.error);
        if (activeReqs.has(msg.id)) activeReqs.delete(msg.id);
        broadcast('speak-state', { state: 'error', error: msg.error });
      }
    }
  });
  voiceProc.on('exit', () => { voiceReady = false; voiceProc = null; activeReqs.clear(); });
}

// 重启语音服务：AI 密钥/配置变更后调用（服务启动时读一次密钥，不重启不会重新加载）
function restartVoiceServer() {
  if (voiceProc) {
    try { voiceProc.kill(); } catch (e) {}
    voiceProc = null;
    voiceReady = false;
  }
  ensureVoiceServer();
}

function flushVoiceQueue() {
  while (voiceQueue.length) {
    const req = voiceQueue.shift();
    if (voiceProc) voiceProc.stdin.write(JSON.stringify(req) + '\n');
  }
}

// 说话入口（对话窗 chat-send / 桌宠输入共用）：输入一律先问 AI（Neco Arc 人设）→ 流式 token → 回复文本 → 合成回复语音播放
async function handleSpeakText(text, force) {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
  const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
  if (!t) return;
  chatModule().recordMsg('me', t); // 用户输入进对话窗历史
  broadcast('speak-state', { state: 'ai' }); // 思考中…
  let reply;
  try {
    reply = await askAI(t, {
      force: !!force, // 重试（↻）：绕过 AI 问答缓存重新生成
      onToken: (tok) => broadcast('ai-token', { text: tok }),
    });
  } catch (e) {
    console.error('[ai] 问答失败:', e.message);
    broadcast('speak-state', { state: 'error', error: 'AI 思考失败: ' + e.message });
    return;
  }
  if (!reply) {
    broadcast('speak-state', { state: 'error', error: 'AI 没有回复' });
    return;
  }
  // 解析情绪标签：标签决定语音合成情绪（voice_server 内部映射到 CosyVoice 参数）
  const { emotion, text: speakText } = parseEmotion(reply);
  console.log(`[ai] 情绪=${emotion} 文本=${speakText}`);
  chatModule().recordMsg('pet', speakText); // 猫姬回复进对话窗历史（对话窗未开也不丢，重开回放）
  // 回复文本（去标签）给渲染层显示
  if (!win.isDestroyed()) broadcast('ai-reply', { text: speakText });
  // 翻唱播放中/静音模式：只出文字不播语音，避免打断用户听歌（静音不影响翻唱音乐）
  if (singPlaying || getAiConfig().muteVoice) { broadcast('speak-state', { state: 'done' }); return; }
  // 合成回复语音（CosyVoice 情绪源 → RVC 变声 → 缓存；情绪进缓存 key）
  broadcast('speak-state', { state: 'generating' });
  // 无语音扩展包：只出文本不合成（基础包降级，不报错打扰用户聊天）——文本仍显示在 arc 旁气泡
  if (!resolveVoiceEnv()) {
    broadcast('bubble-text-only', { text: speakText });
    broadcast('speak-state', { state: 'done' });
    return;
  }
  ensureVoiceServer();
  const id = Date.now();
  activeReqs.add(id);
  const req = { id, text: speakText, emotion };
  // TTS 面板"应用到聊天"：音高偏移/音色贴合/情绪强度/声线 跟随面板参数（默认不跟随）
  const ttsCfg = readTtsConfig();
  if (ttsCfg && ttsCfg.applyToChat) {
    req.f0 = Number(ttsCfg.f0) || 0;
    req.index_rate = ttsCfg.indexRate != null ? Number(ttsCfg.indexRate) : 0.75;
    req.intensity = ttsCfg.intensity != null ? Number(ttsCfg.intensity) : 1;
    req.voice = String(ttsCfg.voice || '');
  }
  // 口癖原版音频开关：全局生效（默认 true=映射拼接；false=直接朗读口癖词）
  if (ttsCfg) req.meow_clips = ttsCfg.meowClips !== false;
  if (force) req.force = true; // 重试：绕过缓存强制重新合成（覆盖旧缓存）
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
}

// TTS 面板生成：直接文本 → 语音（不走 AI 问答），参数可调（音高偏移/索引强度/情绪强度/声线），
// 可指定 out_path 持久保存（voice_server 合成后复制到该路径）。返回 Promise<{wav,out,dur,cached}>
function generateTts(text, params) {
  const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
  if (!t) return Promise.reject(new Error('文本为空'));
  // 无语音扩展包：直接拒绝并给安装引导（TTS 面板显示该错误）
  if (!resolveVoiceEnv()) return Promise.reject(new Error(noVoiceMsg()));
  ensureVoiceServer();
  const id = 'tts-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const req = {
    id,
    text: t,
    emotion: (params && params.emotion) || 'neutral',
    f0: params && params.f0 != null ? Number(params.f0) : 0,
    index_rate: params && params.indexRate != null ? Number(params.indexRate) : 0.75,
    intensity: params && params.intensity != null ? Number(params.intensity) : 1,
    voice: params && params.voice != null ? String(params.voice) : '',
  };
  if (params && params.outPath) req.out_path = String(params.outPath);
  // 口癖原版音频开关（面板保存即生效，未显式传时读已存配置；默认 true=映射拼接，false=直接朗读）
  const ttsCfg = readTtsConfig();
  req.meow_clips = params && params.meowClips != null
    ? !!params.meowClips
    : (ttsCfg ? ttsCfg.meowClips !== false : true);
  return new Promise((resolve, reject) => {
    ttsCallbacks.set(id, { resolve, reject });
    if (voiceReady && voiceProc) {
      try { voiceProc.stdin.write(JSON.stringify(req) + '\n'); } catch (e) { ttsCallbacks.delete(id); reject(e); }
    } else {
      voiceQueue.push(req); // 模型仍在加载，排队等 READY（flushVoiceQueue 会原样写出）
    }
  });
}

function registerVoiceIpc() {
  ipcMain.on('speak-text', (_e, text, force) => handleSpeakText(text, force));
  // 翻唱播放状态：渲染层播放翻唱时发 sing-state('playing'/'paused'/'ended')，主动搭话/随机发声据此避开
  ipcMain.on('sing-state', (_e, s) => { singPlaying = s === 'playing'; });
  // 聊天语音播放状态：渲染层开始/结束播放语音时上报，随机发声倒计时暂停/恢复
  ipcMain.on('voice-playing', () => onVoicePlaying());
  ipcMain.on('voice-done', () => onVoiceDone());
  // 加载随机发声素材并启动定时器（配置保存后由 ai-config.js 调 restart 刷新）
  loadVoiceClips();
  // 模块加载即按当前配置启动主动说话/随机发声定时器
  restartProactiveTimer();
  restartVoiceTimer();
}

module.exports = { registerVoiceIpc, handleSpeakText, handleProactiveSpeak, restartProactiveTimer, restartVoiceTimer, generateTts, readTtsConfig, restartVoiceServer };
