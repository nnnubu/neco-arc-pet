// 主进程 - 语音服务模块：懒启动长驻 Python 服务，stdin/stdout JSON 协议管理
// 协议见 voice/voice_server.py：-> {"id":1,"text":"..."}  <- {"event":"ready"} / {"id":1,"ok":true,"wav":"..."}
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');
const { getChatWin } = require('./chat');
const { askAI } = require('./ai');

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
        broadcast('play-audio', msg.wav);
        broadcast('speak-state', { state: 'done' });
      } else if (msg.ok) {
        // 其他 ok（如 preset started）：无需处理
      } else {
        console.error('[voice] 生成失败:', msg.error);
        broadcast('speak-state', { state: 'error', error: msg.error });
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

// 说话入口（对话窗 chat-send / 桌宠输入共用）：输入一律先问 AI（Neco Arc 人设）→ 流式 token → 回复文本 → 合成回复语音播放
async function handleSpeakText(text, force) {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
  const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
  if (!t) return;
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
  // 回复文本（去标签）给渲染层显示
  if (!win.isDestroyed()) broadcast('ai-reply', { text: speakText });
  // 合成回复语音（CosyVoice 情绪源 → RVC 变声 → 缓存；情绪进缓存 key）
  broadcast('speak-state', { state: 'generating' });
  ensureVoiceServer();
  const req = { id: Date.now(), text: speakText, emotion };
  if (force) req.force = true; // 重试：绕过缓存强制重新合成（覆盖旧缓存）
  if (voiceReady && voiceProc) {
    voiceProc.stdin.write(JSON.stringify(req) + '\n');
  } else {
    voiceQueue.push(req); // 模型仍在加载，排队等 READY
  }
}

function registerVoiceIpc() {
  ipcMain.on('speak-text', (_e, text, force) => handleSpeakText(text, force));
}

module.exports = { registerVoiceIpc, handleSpeakText };
