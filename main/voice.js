// 主进程 - 语音服务模块：懒启动长驻 Python 服务，stdin/stdout JSON 协议管理
// 协议见 voice/voice_server.py：-> {"id":1,"text":"..."}  <- {"event":"ready"} / {"id":1,"ok":true,"wav":"..."}
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');
const { getChatWin, recordMsg } = require('./chat');
const { askAI, getAiConfig } = require('./ai');

// 对话事件广播：桌宠窗（播放音频/透明文字逐字）+ 对话窗（消息气泡/状态显示）
function broadcast(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  const chat = getChatWin();
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
let proactiveTimer = null;

function isSpeaking() { return activeReqs.size > 0; }

// 重启主动说话定时器（配置保存 / 模块加载时调用；间隔取配置，开关关闭则停）
function restartProactiveTimer() {
  if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
  const cfg = getAiConfig();
  if (!cfg.proactiveEnabled) return;
  const min = Math.max(1, Number(cfg.proactiveIntervalMin) || 30);
  proactiveTimer = setInterval(() => {
    if (isSpeaking()) return; // 用户正在听/正在合成中，不打扰
    handleProactiveSpeak();
  }, min * 60 * 1000);
}

// 主动搭话：以"主动指令"问 AI（force 绕过问答缓存，每次都生成新台词）→ 走标准合成播放
async function handleProactiveSpeak() {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  const cfg = getAiConfig();
  if (!cfg.proactiveEnabled) return;
  broadcast('speak-state', { state: 'ai' }); // 思考中…
  let reply;
  try {
    reply = await askAI(cfg.proactivePrompt || '主动找人类搭一句话：简短一句，用猫姬人设，直接输出台词不要解释。', {
      force: true,
      onToken: (tok) => broadcast('ai-token', { text: tok }),
    });
  } catch (e) {
    console.error('[proactive] 主动搭话 AI 失败:', e.message);
    broadcast('speak-state', { state: 'error', error: '主动说话失败: ' + e.message });
    return;
  }
  if (!reply) {
    broadcast('speak-state', { state: 'error', error: '主动说话没有回复' });
    return;
  }
  const { emotion, text: speakText } = parseEmotion(reply);
  console.log(`[proactive] 情绪=${emotion} 文本=${speakText}`);
  recordMsg('pet', speakText); // 进对话窗历史（即使对话窗未打开，重开可见）
  if (!win.isDestroyed()) broadcast('ai-reply', { text: speakText });
  broadcast('speak-state', { state: 'generating' });
  ensureVoiceServer();
  const id = Date.now();
  activeReqs.add(id);
  const req = { id, text: speakText, emotion, force: true };
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
}

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
        broadcast('speak-state', { state: 'ready' });
      } else if (msg.event === 'preset_done') {
        // 预生成完成：只记录，不触发播放/状态（避免误报"出错了"）
        console.log('[voice] 预生成完成:', msg.count);
      } else if (msg.ok && msg.wav) {
        if (activeReqs.has(msg.id)) activeReqs.delete(msg.id);
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
  recordMsg('me', t); // 用户输入进对话窗历史
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
  recordMsg('pet', speakText); // 猫姬回复进对话窗历史（对话窗未开也不丢，重开回放）
  // 回复文本（去标签）给渲染层显示
  if (!win.isDestroyed()) broadcast('ai-reply', { text: speakText });
  // 合成回复语音（CosyVoice 情绪源 → RVC 变声 → 缓存；情绪进缓存 key）
  broadcast('speak-state', { state: 'generating' });
  ensureVoiceServer();
  const id = Date.now();
  activeReqs.add(id);
  const req = { id, text: speakText, emotion };
  if (force) req.force = true; // 重试：绕过缓存强制重新合成（覆盖旧缓存）
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
}

function registerVoiceIpc() {
  ipcMain.on('speak-text', (_e, text, force) => handleSpeakText(text, force));
  // 模块加载即按当前配置启动主动说话定时器（面板保存后由 ai-config.js 调 restart 刷新）
  restartProactiveTimer();
}

module.exports = { registerVoiceIpc, handleSpeakText, handleProactiveSpeak, restartProactiveTimer };
