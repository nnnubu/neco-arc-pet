// 主进程 - 翻唱面板模块（整合进总面板）：拖拽/选择音频 → 开始翻唱（复用 sing-song 链路）→ 进度/完成/错误回显
//               历史列表播放/暂停控制/打开文件夹；播放由桌宠渲染层执行（singAudio + 桌面歌词）
// 总面板方案：作为 WebContentsView 挂载在主窗口内容区，渲染层/Preload/IPC 完全复用
const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getWin } = require('./window');
const { scanSingHistory, getLyricsByTitle } = require('./lyric');
const { openModule, wrapView, hideMaster, minimizeMaster, getMasterWin } = require('./master-panel');
const { getVoiceRoot } = require('./paths');
// 注意：不在这里顶层解构 ./sing 的 startSing —— sing.js 与本模块互相 require（sing.js 顶层引 getSingPanelWin），
// 顶层解构会拿到未完成的空导出；改为回调运行时 require（届时模块已完整加载）

// 用户勾选"使用歌词文件"后选定的 .lrc；与歌曲绑定（song=null 表示未绑定，首次播放时绑定当前歌）
let panelLrc = { path: null, song: null };

function getSingPanelWin() {
  // 总面板模式下返回 view 包装（广播链路 sing.js/lyric.js 原样可用）
  return wrapView('sing');
}

function setPanelLrc(p, song) {
  if (!p) { panelLrc = { path: null, song: null }; return; }
  panelLrc = { path: String(p), song: song || null };
}
function getPanelLrc() { return panelLrc; }

// 播放某首歌时消费歌词文件：
//   绑定歌 == 播放歌 → 返回 lrc（使用）
//   未绑定 → 绑定当前歌并返回 lrc（首次使用生效）
//   绑定其他歌 → 清空 lrc 并通知面板取消勾选（避免串歌词，返回 null → 走联网）
function consumePanelLrc(song) {
  const lrc = panelLrc;
  if (!lrc || !lrc.path) return null;
  if (lrc.song === song) return lrc;
  if (lrc.song == null) { setPanelLrc(lrc.path, song); return panelLrc; }
  setPanelLrc(null, null);
  const panel = getSingPanelWin();
  if (panel && !panel.isDestroyed()) panel.webContents.send('sing-panel-lrc-cleared');
  return null;
}

// 打开（或切换）翻唱面板：总面板内
function showSingPanel() {
  openModule('sing');
}

function closeSingPanel() {
  hideMaster();
}

function registerSingPanelIpc() {
  // 菜单入口
  ipcMain.on('sing-panel-open', () => showSingPanel());
  ipcMain.on('sing-panel-close', () => closeSingPanel());
  ipcMain.on('sing-panel-minimize', () => minimizeMaster());

  // 选音频文件（点击拖拽区）
  ipcMain.handle('sing-panel-pick', async () => {
    const r = await dialog.showOpenDialog(getMasterWin() || undefined, {
      title: '选择要翻唱的音频',
      properties: ['openFile'],
      filters: [
        { name: '音频', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'ape'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  // 面板「开始翻唱」→ 直接走翻唱链路（与输入框「唱 xx」同一入口，进度广播回面板）
  ipcMain.on('sing-panel-start', (_e, p) => {
    require('./sing').startSing(String(p || ''));
  });

  // 选歌词文件（勾选"使用歌词文件"后点击歌词选框）；song=当前正在播放/显示的歌（绑定，避免别的歌误用）
  ipcMain.handle('sing-panel-pick-lrc', async (_e, song) => {
    const r = await dialog.showOpenDialog(getMasterWin() || undefined, {
      title: '选择歌词文件（.lrc / .txt）',
      properties: ['openFile'],
      filters: [
        { name: '歌词', extensions: ['lrc', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const p = r.filePaths[0];
    try { fs.accessSync(p, fs.constants.R_OK); } catch { return { ok: false, error: '文件不可读' }; }
    setPanelLrc(p, song);
    return { ok: true, path: p, name: path.basename(p), song: song || null };
  });

  // 拖拽歌词文件到选框：上报路径 + 当前播放歌名（空字符串 = 清空）
  ipcMain.handle('sing-panel-set-lrc', (_e, p, song) => {
    if (!p) { setPanelLrc(null, null); return { ok: true, cleared: true }; }
    const s = String(p);
    try { fs.accessSync(s, fs.constants.R_OK); } catch { return { ok: false, error: '文件不可读' }; }
    setPanelLrc(s, song);
    return { ok: true, path: s, name: path.basename(s), song: song || null };
  });

  // 面板「显示歌词」：重开桌面歌词窗口（关闭后可再次打开）
  ipcMain.handle('sing-panel-lyric', () => {
    const reopened = require('./lyric').reopenLyric();
    return reopened;
  });

  // 面板播放/暂停按钮 → 桌宠渲染层 toggle 翻唱播放
  ipcMain.on('sing-panel-toggle', () => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-toggle');
  });
  // 翻唱音量：面板滑块 → 桌宠窗 singAudio.volume（0~1）
  ipcMain.on('sing-panel-volume', (_e, v) => {
    const vol = Math.max(0, Math.min(1, Number(v) || 0));
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('sing-volume', vol);
  });

  // 面板历史列表播放某首歌 → 立即播放 + 歌词异步补发（广播：桌宠窗播 + 对话窗显示）
  ipcMain.on('sing-panel-play', (_e, name) => {
    const w = getWin();
    if (!w || w.isDestroyed()) return;
    const dir = path.join(getVoiceRoot(), 'sing_output', String(name || ''));
    try {
      const full = fs.readdirSync(dir).find((f) => f.endsWith('_猫姬翻唱.wav'));
      if (!full) return;
      const p = path.join(dir, full);
      if (!fs.existsSync(p)) return; // 文件被删/占位：不播
      require('./sing').broadcast('sing-play', { full: p, vocal: null, name: String(name), dir });
      // 歌词来源：面板自定义 .lrc（消费逻辑：绑定匹配才用；绑定其他歌自动清空+取消勾选）→ 否则原歌名联网兜底
      const lrc = consumePanelLrc(String(name));
      if (lrc && lrc.path) {
        try {
          const text = fs.readFileSync(lrc.path, 'utf8');
          const parsed = require('./lyric').parseLrc(text);
          if (parsed.length) {
            w.webContents.send('sing-lyric', { lyrics: parsed, title: String(name), source: 'custom' });
            return;
          }
        } catch (e) {}
      }
      getLyricsByTitle(String(name)).then((lyr) => {
        if (w && !w.isDestroyed()) {
          if (lyr && lyr.lyrics && lyr.lyrics.length) {
            w.webContents.send('sing-lyric', lyr);
          } else {
            // 本地无 .lrc 且联网搜不到 → 桌面歌词显示"暂无歌词"占位
            w.webContents.send('sing-lyric', { lyrics: [], title: String(name), source: 'none' });
          }
        }
      }).catch(() => {
        if (w && !w.isDestroyed()) {
          w.webContents.send('sing-lyric', { lyrics: [], title: String(name), source: 'none' });
        }
      });
    } catch (e) {}
  });

  // 面板「打开翻唱文件夹」
  ipcMain.on('sing-panel-dir', () => {
    const dir = path.join(getVoiceRoot(), 'sing_output');
    if (fs.existsSync(dir)) shell.openPath(dir);
  });

  // 面板查询历史
  ipcMain.handle('sing-panel-history', () => scanSingHistory());
  // 语音引擎状态：无语音扩展包时面板显示安装引导
  ipcMain.handle('sing-panel-engine', () => {
    const { resolveVoiceEnv, NO_VOICE_MSG } = require('./paths');
    return { voiceEngine: !!resolveVoiceEnv(), noVoiceMsg: NO_VOICE_MSG };
  });
  // ── 桌面歌词颜色（配置化，默认当前亮黄 #ffd04d）：读写 tts-config.json（运行时 require 防循环依赖）──
  ipcMain.handle('sing-panel-get-lyric-color', () => {
    try { return require('./tts-panel').loadConfig().lyricColor; } catch (e) { return '#ffd04d'; }
  });
  ipcMain.on('sing-panel-set-lyric-color', (_e, hex) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(hex || ''))) return;
    try {
      const tp = require('./tts-panel');
      const full = tp.loadConfig();               // 拿全量（防 saveConfig 只传单字段重置其他配置）
      full.lyricColor = String(hex);
      tp.saveConfig(full);
    } catch (e) {}
  });
}

module.exports = { showSingPanel, closeSingPanel, getSingPanelWin, registerSingPanelIpc, setPanelLrc, getPanelLrc, consumePanelLrc };
