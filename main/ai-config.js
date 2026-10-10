// 主进程 - AI 设置面板：密钥/模型/接口/提示词 配置化（保存到 assets/ai-config.json）
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getAiConfig, updateAiConfig, defaultSystemPrompt } = require('./ai');

let cfgWin = null;

function showAiConfig() {
  if (cfgWin && !cfgWin.isDestroyed()) {
    if (cfgWin.isMinimized()) cfgWin.restore();
    cfgWin.show();
    cfgWin.focus();
    return;
  }
  const W = 720, H = 580;
  cfgWin = new BrowserWindow({
    width: W, height: H,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    fullscreenable: false,
    backgroundColor: '#1c1c26',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'ai-config-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  cfgWin.loadFile(path.join(__dirname, '..', 'renderer', 'ai-config.html'));
  cfgWin.on('closed', () => { cfgWin = null; });
  cfgWin.webContents.once('did-finish-load', () => {
    if (cfgWin && !cfgWin.isDestroyed()) { cfgWin.show(); cfgWin.focus(); }
  });
}

function registerAiConfigIpc() {
  ipcMain.on('ai-config-open', () => showAiConfig());
  ipcMain.on('ai-config-close', () => { if (cfgWin && !cfgWin.isDestroyed()) cfgWin.destroy(); cfgWin = null; });
  ipcMain.on('ai-config-minimize', () => { if (cfgWin && !cfgWin.isDestroyed()) cfgWin.minimize(); });

  // 读取当前配置（面板打开时回填表单）
  ipcMain.handle('ai-config-load', () => {
    const c = getAiConfig();
    return {
      apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model,
      temperature: c.temperature, maxTokens: c.maxTokens, systemPrompt: c.systemPrompt,
      webSearchEnabled: c.webSearchEnabled,
      proactiveEnabled: c.proactiveEnabled, proactiveIntervalMin: c.proactiveIntervalMin, proactivePrompt: c.proactivePrompt,
    };
  });

  // 保存配置：写 assets/ai-config.json + 更新内存（下次问答立即生效）
  ipcMain.handle('ai-config-save', (_e, cfg) => {
    try {
      const saved = updateAiConfig(cfg);
      // 主动说话配置可能变了：重启定时器（开关/间隔生效）
      try { require('./voice').restartProactiveTimer(); } catch (e) { console.error('[ai-config] 重启主动说话定时器失败:', e.message); }
      return { ok: true, config: saved };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 立即主动说一句（面板"立即说一句"测试按钮；配置未开也触发，便于验收）
  ipcMain.handle('ai-config-proactive-now', () => {
    try {
      const { handleProactiveSpeak } = require('./voice');
      handleProactiveSpeak();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 恢复默认提示词（面板"恢复默认"用，只返回文本不写文件）
  ipcMain.handle('ai-config-default-prompt', () => defaultSystemPrompt());

  // 测试连接：用当前表单值发一条固定消息，验证密钥/模型/接口是否可用（不写配置）
  ipcMain.handle('ai-config-test', async (_e, cfg) => {
    const { askAI } = require('./ai');
    const { apiKey, baseUrl, model, systemPrompt, temperature, maxTokens } = cfg || {};
    if (!apiKey || !baseUrl || !model) return { ok: false, error: '请先填写密钥、接口地址和模型' };
    // 临时用表单值测试：备份恢复
    const saved = getAiConfig();
    try {
      updateAiConfig({
        apiKey, baseUrl, model,
        temperature: temperature != null ? temperature : saved.temperature,
        maxTokens: maxTokens != null ? maxTokens : saved.maxTokens,
        systemPrompt: systemPrompt || saved.systemPrompt,
      });
      const reply = await askAI('喵？测试一下能不能听到本喵说话喵！', { force: true, timeoutMs: 15000 });
      return { ok: true, reply };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      // 恢复原配置（测试不落盘）
      updateAiConfig(saved);
    }
  });
}

module.exports = { showAiConfig, registerAiConfigIpc };
