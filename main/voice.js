// 主进程 - 语音服务模块：懒启动长驻 Python 服务，stdin/stdout JSON 协议管理
// 协议见 voice/voice_server.py：-> {"id":1,"text":"..."}  <- {"event":"ready"} / {"id":1,"ok":true,"wav":"..."}
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');

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
  voiceProc = spawn(py, [script], { cwd: path.join(__dirname, '..', 'voice'), stdio: ['pipe', 'pipe', logFile] });
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
        if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('speak-state', { state: 'ready' });
      } else if (msg.ok) {
        if (getWin() && !getWin().isDestroyed()) {
          getWin().webContents.send('play-audio', msg.wav);
          getWin().webContents.send('speak-state', { state: 'done' });
        }
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
  ipcMain.on('speak-text', (_e, text) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
    const t = String(text || '').replace(/[\uD800-\uDFFF]/g, '').trim();
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
}

module.exports = { registerVoiceIpc };
