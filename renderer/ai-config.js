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
      ttsModel: $('#inTtsModel').value.trim(),
      ttsApiKey: $('#inTtsKey').value.trim(),
      ttsBaseUrl: $('#inTtsBase').value.trim(),
      ttsEdgeFallback: !!$('#inEdgeFallback').checked,
      kbModel: $('#inKbModel').value.trim(),
      kbApiKey: $('#inKbKey').value.trim(),
      kbBaseUrl: $('#inKbBase').value.trim(),
      kbMode: $('#inKbMode').value === 'always' ? 'always' : ($('#inKbMode').value === 'custom' ? 'custom' : 'auto'),
      kbWords: $('#inKbWords').value.trim(),
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
    $('#inTtsModel').value = c.ttsModel || '';
    $('#inTtsKey').value = c.ttsApiKey || '';
    $('#inTtsBase').value = c.ttsBaseUrl || '';
    $('#inEdgeFallback').checked = c.ttsEdgeFallback !== false;
    $('#inKbModel').value = c.kbModel || '';
    $('#inKbKey').value = c.kbApiKey || '';
    $('#inKbBase').value = c.kbBaseUrl || '';
    $('#inKbMode').value = c.kbMode === 'always' ? 'always' : (c.kbMode === 'custom' ? 'custom' : 'auto');
    $('#inKbWords').value = c.kbWords || '';
    // 未安装语音扩展包：隐藏语音合成配置区（含分隔线）
    if (c.voiceInstalled === false) $('#ttsSection').classList.add('hidden');
    syncSearchWordsVisibility();
    syncKbWordsVisibility();
  });

  // 触发方式切换：仅"自定义关键词"时显示关键词输入框
  function syncSearchWordsVisibility() {
    $('#lblSearchWords').classList.toggle('hidden', $('#inSearchMode').value !== 'custom');
  }
  $('#inSearchMode').addEventListener('change', syncSearchWordsVisibility);
  function syncKbWordsVisibility() {
    $('#lblKbWords').classList.toggle('hidden', $('#inKbMode').value !== 'custom');
  }
  $('#inKbMode').addEventListener('change', syncKbWordsVisibility);

  // 密钥明文/密文切换（文本/语音各一）
  function bindKeyEye(inputSel, btnSel) {
    $(btnSel).addEventListener('click', () => {
      const el = $(inputSel);
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      $(btnSel).textContent = show ? '🙈' : '👁';
    });
  }
  bindKeyEye('#inKey', '#btnKeyEye');
  bindKeyEye('#inTtsKey', '#btnTtsKeyEye');
  bindKeyEye('#inKbKey', '#btnKbKeyEye');

  // 保存（语音合成模型非必填：未装语音模块/暂不启用语音的用户可留空保存；运行时未填会提示）
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

  // TTS 后端测试：先保存当前表单（模型 ID/兜底开关需落到 ai-config.json，voice_server 才能读到），
  // 再调 voice-test-tts 让语音服务合成一句并返回耗时。硅基模型测试不需要 API Key 前置（错误会直接返回）
  async function runTtsTest(provider) {
    const cfg = readForm();
    // 测语音模型需三字段齐全；测免费兜底不依赖（Edge/系统语音直接可用）
    if (provider !== 'edge') {
      if (!cfg.ttsModel) { setMsg(t('msgNoTtsModel'), true); return; }
      if (!cfg.ttsApiKey) { setMsg(t('msgNoTtsKey'), true); return; }
      if (!cfg.ttsBaseUrl) { setMsg(t('msgNoTtsBase'), true); return; }
    }
    $('#btnSave').disabled = true;
    const sv = await window.aiConfigApi.save(cfg);
    $('#btnSave').disabled = false;
    if (!(sv && sv.ok)) { setMsg(t('msgSaveFail') + (sv && sv.error), true); return; }
    const btn = provider === 'edge' ? $('#btnTestEdge') : $('#btnTestCosy');
    const label = provider === 'edge' ? t('btnTestEdge') : t('btnTestCosy');
    btn.disabled = true;
    btn.textContent = t('btnTesting');
    setMsg('');
    const r = await window.aiConfigApi.testTts(provider);
    btn.disabled = false;
    btn.textContent = label;
    if (r && r.ok) setMsg(t('msgTtsOk').replace('{used}', String(r.used || provider)).replace('{ms}', String(r.ms)));
    else setMsg(t('msgTtsFail') + (r && r.error), true);
  }
  $('#btnTestCosy').addEventListener('click', () => runTtsTest('siliconflow'));
  $('#btnTestEdge').addEventListener('click', () => runTtsTest('edge'));

  // 知识库嵌入模型测试：先保存（kb 字段落盘），再调后端生成一句向量返回维度与耗时
  $('#btnTestKb').addEventListener('click', async () => {
    const cfg = readForm();
    if (!cfg.kbModel || !cfg.kbApiKey || !cfg.kbBaseUrl) { setMsg(t('msgNoKbConfig'), true); return; }
    $('#btnSave').disabled = true;
    const sv = await window.aiConfigApi.save(cfg);
    $('#btnSave').disabled = false;
    if (!(sv && sv.ok)) { setMsg(t('msgSaveFail') + (sv && sv.error), true); return; }
    const btn = $('#btnTestKb');
    btn.disabled = true;
    btn.textContent = t('btnTesting');
    setMsg(t('msgKbTesting'));
    const r = await window.aiConfigApi.testKb();
    btn.disabled = false;
    btn.textContent = t('btnTestKb');
    if (r && r.ok) setMsg(t('msgKbOk').replace('{dim}', String(r.dim)).replace('{ms}', String(r.ms)));
    else setMsg(t('msgKbFail') + (r && r.error), true);
  });

  // 标题栏按钮：最大化/还原 / 最小化 / 关闭
  const btnMax = $('#btnMax');
  let maxed = false;
  function refreshMax() {
    btnMax.textContent = maxed ? '❐' : '⛶';
    btnMax.title = maxed ? t('btnRestore') : t('btnMax');
  }
  btnMax.addEventListener('click', () => window.aiConfigApi.maximize());
  window.aiConfigApi.onMaxState((m) => { maxed = !!m; refreshMax(); });
  window.addEventListener('i18n-change', refreshMax);
  refreshMax();
  $('#btnMin').addEventListener('click', () => window.aiConfigApi.minimize());
  $('#btnClose').addEventListener('click', () => window.aiConfigApi.close());

  // 语言切换后同步下拉（其他窗口广播回来也会触发）
  window.addEventListener('i18n-change', syncLangSelect);
  window.NECO_I18N.init().then(syncLangSelect);
})();
