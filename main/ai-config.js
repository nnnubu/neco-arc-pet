// 主进程 - AI 设置面板模块（整合进总面板）：密钥/模型/接口/提示词 配置化（保存到 assets/ai-config.json）
// 总面板方案：作为 WebContentsView 挂载在主窗口内容区，渲染层/Preload/IPC 完全复用
const { ipcMain } = require('electron');
const { getAiConfig, updateAiConfig, defaultSystemPrompt } = require('./ai');
const { openModule, hideMaster, minimizeMaster } = require('./master-panel');

function showAiConfig() {
  openModule('ai');
}

function registerAiConfigIpc() {
  ipcMain.on('ai-config-open', () => showAiConfig());
  ipcMain.on('ai-config-close', () => hideMaster());
  ipcMain.on('ai-config-minimize', () => minimizeMaster());

  // 读取当前配置（面板打开时回填表单）
  ipcMain.handle('ai-config-load', () => {
    const c = getAiConfig();
    return {
      apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model,
      temperature: c.temperature, maxTokens: c.maxTokens, systemPrompt: c.systemPrompt,
      webSearchEnabled: c.webSearchEnabled,
      proactiveEnabled: c.proactiveEnabled, proactiveIntervalMin: c.proactiveIntervalMin, proactivePrompt: c.proactivePrompt,
      randomVoiceEnabled: c.randomVoiceEnabled, randomVoiceMin: c.randomVoiceMin, randomVoiceMax: c.randomVoiceMax,
      muteVoice: c.muteVoice,
    };
  });

  // 保存配置：写 assets/ai-config.json + 更新内存（下次问答立即生效）
  ipcMain.handle('ai-config-save', (_e, cfg) => {
    try {
      const saved = updateAiConfig(cfg);
      // 主动说话/随机发声配置可能变了：重启定时器（开关/间隔生效）
      try { require('./voice').restartProactiveTimer(); } catch (e) { console.error('[ai-config] 重启主动说话定时器失败:', e.message); }
      try { require('./voice').restartVoiceTimer(); } catch (e) { console.error('[ai-config] 重启随机发声定时器失败:', e.message); }
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
    if (!apiKey || !baseUrl || !model) return { ok: false, error: require('./i18n').t('msgNoAll') };
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
