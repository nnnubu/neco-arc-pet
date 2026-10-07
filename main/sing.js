// 主进程 - 唱歌模块：spawn voice/sing.py 执行翻唱（分离→变声→混音）
// IPC：renderer -> sing-song(歌曲路径)；renderer <- sing-progress(stage) / sing-done(输出路径) / sing-error(错误)
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getWin } = require('./window');

let singProc = null; // 防重入：一次只翻唱一首

function registerSingIpc() {
  ipcMain.on('sing-song', (_e, songPath) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    const p = String(songPath || '').trim();
    if (!p) { win.webContents.send('sing-error', '路径为空'); return; }
    if (!fs.existsSync(p)) { win.webContents.send('sing-error', '找不到文件: ' + p); return; }
    if (singProc) { win.webContents.send('sing-error', '正在翻唱中，请稍候再试'); return; }

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
        if (msg.stage) win.webContents.send('sing-progress', { stage: msg.stage });
        if (msg.done) win.webContents.send('sing-done', msg.done);
        if (msg.error) {
          console.error('[sing] 翻唱失败:', msg.error);
          win.webContents.send('sing-error', msg.error);
        }
      }
    });
    singProc.on('exit', () => { singProc = null; });
  });
}

module.exports = { registerSingIpc };
