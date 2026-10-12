// 主进程 - 唱歌模块：spawn voice/sing.py 执行翻唱（分离→变声→混音）
// IPC：renderer -> sing-song(歌曲路径)；renderer <- sing-progress(stage) / sing-done(输出路径) / sing-error(错误)
//       翻唱面板复用 startSing（sing-panel-start）；进度/完成/错误同时广播给面板窗口
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');
const { getLyrics, parseLrc } = require('./lyric');
const { getSingPanelWin, consumePanelLrc } = require('./sing-panel');
const { getChatWin } = require('./chat');
const { resolveVoiceEnv, noVoiceMsg } = require('./paths');

let singProc = null; // 防重入：一次只翻唱一首

// 广播给桌宠渲染层 + 翻唱面板 + 对话窗（面板可能在翻唱中打开，对话窗显示完成消息）
function broadcast(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  const panel = getSingPanelWin();
  if (panel && !panel.isDestroyed()) panel.webContents.send(channel, payload);
  const chat = getChatWin();
  if (chat && !chat.isDestroyed()) chat.webContents.send(channel, payload);
}

// 开始翻唱（输入框「唱 xx」/ 翻唱面板 共用）
function startSing(songPath) {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  const p = String(songPath || '').trim();
  if (!p) { broadcast('sing-error', '路径为空'); return; }
  if (!fs.existsSync(p)) { broadcast('sing-error', '找不到文件: ' + p); return; }
  if (singProc) { broadcast('sing-error', '正在翻唱中，请稍候再试'); return; }

  // 语音引擎探测：语音扩展包解压到程序根目录后自动可用；无引擎则给出安装引导
  const env = resolveVoiceEnv();
  if (!env) { broadcast('sing-error', noVoiceMsg()); return; }
  const py = env.py;
  const script = path.join(env.voiceDir, 'sing.py');
  // TTS 面板"应用到翻唱"：音高偏移/音色贴合传给 sing.py（情绪/声线是 CosyVoice 源头参数，
  // 翻唱直接 RVC 变声不适用，只有 f0/index_rate 生效）
  const args = [script, p];
  try {
    const ttsCfg = require('./voice').readTtsConfig();
    if (ttsCfg && ttsCfg.applyToSing) {
      const f0 = ttsCfg.f0 != null ? Number(ttsCfg.f0) : 0;
      const ir = ttsCfg.indexRate != null ? Number(ttsCfg.indexRate) : 0.75;
      args.push('--f0', String(f0), '--index-rate', String(ir));
    }
  } catch (e) {}
  // stderr 进日志文件（GPU 加载日志量大，管道消费不及时会卡死进程）
  const logFile = fs.openSync(path.join(env.voiceDir, 'sing.log'), 'a');
  // windowsHide: true 防止 python 弹出黑框抢焦点
  singProc = spawn(py, args, { cwd: env.voiceDir, stdio: ['ignore', 'pipe', logFile], windowsHide: true });

  let buf = '';
  singProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.stage) broadcast('sing-progress', { stage: msg.stage });
      if (msg.done) {
        // 翻唱完成：立即发完成消息让渲染层马上自动播放（不等歌词搜索）
        // sing.py 只输出 full/vocal，补 name（full 父目录名=原曲名，与翻唱历史列表一致）
        const doneMsg = Object.assign({}, msg.done);
        if (!doneMsg.name && doneMsg.full) {
          try { doneMsg.name = path.basename(path.dirname(doneMsg.full)); } catch (e) {}
        }
        broadcast('sing-done', doneMsg);
        // 歌词异步补发：面板自定义 .lrc（消费逻辑：绑定原曲名才用，绑定其他歌自动清空）→ 本地同名 .lrc → 网易云兜底
        const srcName = path.basename(p, path.extname(p));
        const lrc = consumePanelLrc(srcName);
        if (lrc && lrc.path) {
          try {
            const text = fs.readFileSync(lrc.path, 'utf8');
            const parsed = parseLrc(text);
            if (parsed.length) {
              win.webContents.send('sing-lyric', { lyrics: parsed, title: srcName, source: 'custom' });
              return;
            }
          } catch (e) {}
        }
        getLyrics(p).then((lyr) => {
          if (win && !win.isDestroyed()) {
            if (lyr && lyr.lyrics && lyr.lyrics.length) {
              win.webContents.send('sing-lyric', lyr);
            } else {
              // 本地无 .lrc 且联网搜不到 → 桌面歌词显示"暂无歌词"占位
              win.webContents.send('sing-lyric', { lyrics: [], title: srcName, source: 'none' });
            }
          }
        }).catch(() => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('sing-lyric', { lyrics: [], title: srcName, source: 'none' });
          }
        });
      }
      if (msg.error) {
        console.error('[sing] 翻唱失败:', msg.error);
        broadcast('sing-error', msg.error);
      }
    }
  });
  singProc.on('exit', () => { singProc = null; });
}

function registerSingIpc() {
  ipcMain.on('sing-song', (_e, songPath) => startSing(songPath));
}

module.exports = { registerSingIpc, startSing, broadcast };
