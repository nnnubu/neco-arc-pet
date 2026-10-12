// AI 设置面板渲染：表单回填 / 保存 / 测试连接 / 恢复默认 / 界面语言切换
(function () {
  const $ = (s) => document.querySelector(s);
  const { t } = window.NECO_I18N;
  const msg = $('#msg');
  function setMsg(text, isErr) {
    msg.textContent = text || '';
    msg.className = isErr ? 'error' : '';
  }

  // 界面语言：当前语言回填下拉；切换 → 主进程保存并广播所有窗口
  function syncLangSelect() {
    $('#inLang').value = window.NECO_I18N.lang === 'en' ? 'en' : 'zh';
  }
  $('#inLang').addEventListener('change', () => {
    setMsg('');
    window.necoI18n.setLang($('#inLang').value);
  });

  function readForm() {
    return {
      apiKey: $('#inKey').value.trim(),
      baseUrl: $('#inBase').value.trim(),
      model: $('#inModel').value.trim(),
      temperature: parseFloat($('#inTemp').value) || 0.7,
      maxTokens: parseInt($('#inMax').value, 10) || 256,
      systemPrompt: $('#inPrompt').value,
      proactiveEnabled: !!$('#inProactive').checked,
      proactiveIntervalMin: parseInt($('#inInterval').value, 10) || 30,
      proactivePrompt: $('#inProactivePrompt').value.trim(),
      randomVoiceEnabled: !!$('#inRandVoice').checked,
      randomVoiceMin: parseFloat($('#inRvMin').value) || 3,
      randomVoiceMax: parseFloat($('#inRvMax').value) || 8,
      searchMode: $('#inSearchMode').value === 'always' ? 'always' : ($('#inSearchMode').value === 'custom' ? 'custom' : 'auto'),
      searchWords: $('#inSearchWords').value.trim(),
      muteVoice: !!$('#inMute').checked,
    };
  }

  // 回填表单
  window.aiConfigApi.load().then((c) => {
    if (!c) return;
    $('#inKey').value = c.apiKey || '';
    $('#inBase').value = c.baseUrl || '';
    $('#inModel').value = c.model || '';
    $('#inTemp').value = c.temperature != null ? c.temperature : 0.7;
    $('#inMax').value = c.maxTokens != null ? c.maxTokens : 256;
    $('#inPrompt').value = c.systemPrompt || '';
    $('#inProactive').checked = !!c.proactiveEnabled;
    $('#inInterval').value = c.proactiveIntervalMin != null ? c.proactiveIntervalMin : 30;
    $('#inProactivePrompt').value = c.proactivePrompt || '';
    $('#inRandVoice').checked = !!c.randomVoiceEnabled;
    $('#inRvMin').value = c.randomVoiceMin != null ? c.randomVoiceMin : 3;
    $('#inRvMax').value = c.randomVoiceMax != null ? c.randomVoiceMax : 8;
    $('#inSearchMode').value = c.searchMode === 'always' ? 'always' : (c.searchMode === 'custom' ? 'custom' : 'auto');
    $('#inSearchWords').value = c.searchWords || '';
    $('#inMute').checked = !!c.muteVoice;
    syncSearchWordsVisibility();
  });

  // 触发方式切换：仅"自定义关键词"时显示关键词输入框
  function syncSearchWordsVisibility() {
    $('#lblSearchWords').classList.toggle('hidden', $('#inSearchMode').value !== 'custom');
  }
  $('#inSearchMode').addEventListener('change', syncSearchWordsVisibility);

  // 密钥明文/密文切换
  $('#btnKeyEye').addEventListener('click', () => {
    const el = $('#inKey');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    $('#btnKeyEye').textContent = show ? '🙈' : '👁';
  });

  // 保存
  $('#btnSave').addEventListener('click', async () => {
    const cfg = readForm();
    if (!cfg.model) { setMsg(t('msgNoModel'), true); return; }
    if (!cfg.baseUrl) { setMsg(t('msgNoBase'), true); return; }
    $('#btnSave').disabled = true;
    const r = await window.aiConfigApi.save(cfg);
    $('#btnSave').disabled = false;
    if (r && r.ok) setMsg(t('msgSaved'));
    else setMsg(t('msgSaveFail') + (r && r.error), true);
  });

  // 测试连接：用当前表单值发一条消息（不写入配置）
  $('#btnTest').addEventListener('click', async () => {
    const cfg = readForm();
    if (!cfg.apiKey) { setMsg(t('msgNoKey'), true); return; }
    $('#btnTest').disabled = true;
    $('#btnTest').textContent = t('btnTesting');
    setMsg('');
    const r = await window.aiConfigApi.test(cfg);
    $('#btnTest').disabled = false;
    $('#btnTest').textContent = t('btnTest');
    if (r && r.ok) setMsg(t('msgConnOk') + r.reply);
    else setMsg(t('msgConnFail') + (r && r.error), true);
  });

  // 立即主动说一句：无需等定时，直接触发（配置未开启也可用于验收）
  $('#btnProactiveNow').addEventListener('click', async () => {
    $('#btnProactiveNow').disabled = true;
    setMsg('');
    const r = await window.aiConfigApi.proactiveNow();
    $('#btnProactiveNow').disabled = false;
    if (r && r.ok) setMsg(t('msgProactiveDone'));
    else setMsg(t('msgProactiveFail') + (r && r.error), true);
  });

  // 恢复默认提示词
  $('#btnDefault').addEventListener('click', async () => {
    const d = await window.aiConfigApi.defaultPrompt();
    $('#inPrompt').value = d || '';
    setMsg(t('msgDefaultRestored'));
  });

  // 标题栏按钮
  $('#btnMin').addEventListener('click', () => window.aiConfigApi.minimize());
  $('#btnClose').addEventListener('click', () => window.aiConfigApi.close());

  // 语言切换后同步下拉（其他窗口广播回来也会触发）
  window.addEventListener('i18n-change', syncLangSelect);
  window.NECO_I18N.init().then(syncLangSelect);

  // 开发者工具（仅开发版 electron.exe . 显示）：一键生成发布包
  window.aiConfigApi.isDev().then((dev) => {
    if (!dev) return;
    document.getElementById('devTools').hidden = false;
  });
  document.getElementById('btnDevBasic').addEventListener('click', () => { setMsg('正在构建基础包…'); window.aiConfigApi.devBuild('basic'); });
  document.getElementById('btnDevVoice').addEventListener('click', () => { setMsg('正在打包语音扩展包…'); window.aiConfigApi.devBuild('voice'); });
  window.aiConfigApi.onDevBuild((s) => { if (s && s.t) setMsg(s.t); });
})();
