// AI 设置面板渲染：表单回填 / 保存 / 测试连接 / 恢复默认
(function () {
  const $ = (s) => document.querySelector(s);
  const msg = $('#msg');
  function setMsg(text, isErr) {
    msg.textContent = text || '';
    msg.className = isErr ? 'error' : '';
  }

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
  });

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
    if (!cfg.model) { setMsg('请填写模型名称', true); return; }
    if (!cfg.baseUrl) { setMsg('请填写接口地址', true); return; }
    $('#btnSave').disabled = true;
    const r = await window.aiConfigApi.save(cfg);
    $('#btnSave').disabled = false;
    if (r && r.ok) setMsg('已保存并生效喵！');
    else setMsg('保存失败：' + (r && r.error), true);
  });

  // 测试连接：用当前表单值发一条消息（不写入配置）
  $('#btnTest').addEventListener('click', async () => {
    const cfg = readForm();
    if (!cfg.apiKey) { setMsg('请先填写 API 密钥', true); return; }
    $('#btnTest').disabled = true;
    $('#btnTest').textContent = '测试中…';
    setMsg('');
    const r = await window.aiConfigApi.test(cfg);
    $('#btnTest').disabled = false;
    $('#btnTest').textContent = '测试连接';
    if (r && r.ok) setMsg('连接成功，猫姬回复：' + r.reply);
    else setMsg('连接失败：' + (r && r.error), true);
  });

  // 恢复默认提示词
  $('#btnDefault').addEventListener('click', async () => {
    const d = await window.aiConfigApi.defaultPrompt();
    $('#inPrompt').value = d || '';
    setMsg('提示词已恢复为猫姬默认人设');
  });

  // 标题栏按钮
  $('#btnMin').addEventListener('click', () => window.aiConfigApi.minimize());
  $('#btnClose').addEventListener('click', () => window.aiConfigApi.close());
})();
