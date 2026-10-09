// 主进程 - 唱歌模块：spawn voice/sing.py 执行翻唱（分离→变声→混音）
// IPC：renderer -> sing-song(歌曲路径)；renderer <- sing-progress(stage) / sing-done(输出路径) / sing-error(错误)
//       翻唱面板复用 startSing（sing-panel-start）；进度/完成/错误同时广播给面板窗口
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');
const { getLyrics } = require('./lyric');
const { getSingPanelWin } = require('./sing-panel');
const { getChatWin } = require('./chat');

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

  const py = path.join(__dirname, '..', 'voice-env310', 'Scripts', 'python.exe');
  const script = path.join(__dirname, '..', 'voice', 'sing.py');
  // stderr 进日志文件（GPU 加载日志量大，管道消费不及时会卡死进程）
  const logFile = fs.openSync(path.join(__dirname, '..', 'voice', 'sing.log'), 'a');
  // windowsHide: true 防止 python 弹出黑框抢焦点
  singProc = spawn(py, [script, p], { cwd: path.join(__dirname, '..', 'voice'), stdio: ['ignore', 'pipe', logFile], windowsHide: true });

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
        broadcast('sing-done', Object.assign({}, msg.done));
        // 歌词异步补发：本地 .lrc 优先 → 网易云兜底，搜到后单独发 lyric-show 数据
        getLyrics(p).then((lyr) => {
          if (win && !win.isDestroyed() && lyr && lyr.lyrics && lyr.lyrics.length) {
            win.webContents.send('sing-lyric', lyr);
          }
        }).catch(() => {});
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
