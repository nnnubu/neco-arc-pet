/* 对话窗口渲染：消息气泡 + 输入发送 + 状态显示 + 翻唱播放控制
 * 数据全部来自主进程广播（voice.js/sing.js broadcast → 桌宠窗 + 对话窗）
 * 桌宠窗负责音频播放与透明文字逐字，本窗口只做对话交互显示 */
(function () {
  const $ = (s) => document.querySelector(s);
  const { t, tFmt } = window.NECO_I18N;
  const msgs = $('#chatMsgs');
  const statusEl = $('#chatStatus');
  const input = $('#chatInput');
  const np = $('#nowPlaying');
  const npName = $('#npName');
  let lastPetMsg = null; // 当前猫姬气泡（AI 流式累积用）
  let replyText = '';    // AI 回复全文
  let playing = false;   // 翻唱是否播放中（仅用于状态文字显示，播放控制统一在翻唱面板）
  let currentSingName = ''; // 当前播放的翻唱歌名

  function setStatus(text, isError) {
    if (!text) { statusEl.style.display = 'none'; statusEl.textContent = ''; return; }
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : '';
    statusEl.style.display = 'block';
  }

  function setPlayingName(name) {
    currentSingName = name || '';
    npName.textContent = currentSingName;
    np.classList.remove('hidden');
  }

  // 播放状态仅影响底部提示文字；播放/暂停按钮已从对话窗移除（统一在翻唱面板控制）
  function setPlayingUI(state) {
    playing = state === 'playing';
  }

  // 消息气泡：me=用户（右红）/ pet=猫姬（左浅）
  function addMsg(role, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'me' ? 'me' : 'pet');
    const r = document.createElement('span');
    r.className = 'role';
    r.textContent = role === 'me' ? t('roleMe') : t('rolePet');
    const body = document.createElement('span');
    body.textContent = text;
    d.appendChild(r);
    d.appendChild(body);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    if (role === 'pet') lastPetMsg = d;
    return d;
  }

  // ── 发送（force=绕过回答缓存；缓存开关关闭时每次发送都绕过）──
  function send() {
    const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
    if (!t) return;
    addMsg('me', t);
    input.value = '';
    setStatus(cacheEnabled ? window.NECO_I18N.t('statusThinking') : window.NECO_I18N.t('statusNoCache'));
    window.chatApi.sendText(t, !cacheEnabled);
  }
  $('#btnSend').addEventListener('click', () => send());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });

  // ── 联网搜索开关（状态持久化在主进程 ai 配置，打开时高亮）──
  const btnSearch = $('#btnSearch');
  function setSearchUI(on) {
    btnSearch.classList.toggle('on', !!on);
    btnSearch.title = on ? t('searchTitleOn') : t('searchTitleOff');
  }
  window.chatApi.searchState().then(setSearchUI);
  btnSearch.addEventListener('click', async () => {
    const next = await window.chatApi.toggleSearch();
    setSearchUI(next);
  });

  // ── 回答缓存开关（💾）：开=同问同答命中缓存；关=每次重新生成（状态持久化在主进程 ai 配置）──
  const btnCache = $('#btnCache');
  let cacheEnabled = true;
  function setCacheUI(on) {
    cacheEnabled = !!on;
    btnCache.classList.toggle('on', cacheEnabled);
    btnCache.title = cacheEnabled ? t('cacheTitleOn') : t('cacheTitleOff');
  }
  window.chatApi.cacheState().then(setCacheUI);
  btnCache.addEventListener('click', async () => {
    const next = await window.chatApi.cacheToggle();
    setCacheUI(next);
  });

  // ── 清空缓存（🗑️）：清 LLM 回答缓存 + 语音合成缓存，状态行提示各自清理条数 ──
  $('#btnCacheClear').addEventListener('click', async () => {
    const r = await window.chatApi.cacheClear();
    if (r && typeof r === 'object') setStatus(tFmt('statusClearedBoth', { ai: r.ai, wav: r.wav }));
    else if (typeof r === 'number') setStatus(tFmt('statusClearedN', { n: r }));
    else setStatus(t('statusCleared'));
    setTimeout(() => setStatus(''), 2500);
  });

  // ── 静音模式（arc 不说话；翻唱音乐不受影响）──
  const btnMute = $('#tbMute');
  function setMuteUI(m) {
    btnMute.textContent = m ? '🔇' : '🔊';
    btnMute.classList.toggle('on', !!m);
    btnMute.title = m ? t('tbMuteOn') : t('tbMuteOff');
  }
  window.chatApi.muteState().then(setMuteUI);
  btnMute.addEventListener('click', async () => {
    const next = await window.chatApi.muteToggle();
    setMuteUI(next);
  });

  // ── 气泡显示设置（Aa 展开一行：字号滑块 + 文字颜色 + 恢复默认）──
  // 读写 tts-config 同源（与 TTS 面板一致）；基础包无语音扩展包时这里就是唯一入口
  const bubbleSettings = $('#bubbleSettings');
  const btnBubble = $('#btnBubble');
  const bsSize = $('#bsSize');
  const bsSizeVal = $('#bsSizeVal');
  const bsColor = $('#bsColor');
  const bsColorBtn = $('#bsColorBtn');
  let bubbleOpen = false;
  btnBubble.addEventListener('click', () => {
    bubbleOpen = !bubbleOpen;
    bubbleSettings.classList.toggle('hidden', !bubbleOpen);
    btnBubble.classList.toggle('on', bubbleOpen);
  });
  function setBsColorSwatch() {
    bsColorBtn.style.background = bsColor.value;
  }
  function saveBubble() {
    window.chatApi.bubbleSet({ bubbleFontSize: parseInt(bsSize.value, 10) || 16, bubbleColor: bsColor.value });
  }
  bsSize.addEventListener('input', () => { bsSizeVal.textContent = bsSize.value; saveBubble(); });
  // 色块按钮 → 触发原生 color input（透明覆盖其上，点击即弹系统色盘）；选色即时保存并同步色块
  bsColorBtn.addEventListener('click', () => bsColor.click());
  bsColor.addEventListener('input', () => { setBsColorSwatch(); saveBubble(); });
  $('#bsReset').addEventListener('click', () => {
    bsSize.value = 16; bsSizeVal.textContent = '16';
    bsColor.value = '#ffd166';
    setBsColorSwatch();
    saveBubble();
  });
  window.chatApi.bubbleGet().then((cfg) => {
    if (!cfg) return;
    bsSize.value = cfg.bubbleFontSize != null ? cfg.bubbleFontSize : 16;
    bsSizeVal.textContent = bsSize.value;
    bsColor.value = /^#[0-9a-fA-F]{6}$/.test(String(cfg.bubbleColor || '')) ? cfg.bubbleColor : '#ffd166';
    setBsColorSwatch();
  });

  // ── 语音问答状态 ──
  window.chatApi.onSpeakState((s) => {
    if (!s) return;
    if (s.state === 'ai') {
      // 提问开始：立即创建猫姬回复气泡（后续流式 token 累积写入；之前 lastPetMsg 为 null 导致回复不显示）
      setStatus(t('statusThinking'));
      replyText = '';
      addMsg('pet', '');
      lastPetMsg.lastChild.textContent = '';
    }
    else if (s.state === 'generating') { setStatus(t('statusGenerating')); }
    else if (s.state === 'done') { setStatus(''); }
    else if (s.state === 'error') {
      setStatus(t('statusError') + (s.error || t('statusUnknown')), true);
      addMsg('pet', t('statusError') + (s.error || t('statusUnknown')));
    }
  });

  // AI 流式 token：累积文本 + 实时更新猫姬气泡
  window.chatApi.onAiToken((r) => {
    if (!r || !r.text) return;
    replyText += r.text;
    if (lastPetMsg) lastPetMsg.querySelector('span:last-child').textContent = replyText;
  });
  // AI 回复完成：更新气泡（完整文本）
  window.chatApi.onAiReply((r) => {
    replyText = (r && r.text) || '';
    if (lastPetMsg) lastPetMsg.querySelector('span:last-child').textContent = replyText;
  });

  // ── 翻唱：进度 / 完成 / 错误 / 播放 ──
  window.chatApi.onSingProgress((s) => {
    if (!s) return;
    setStatus({ separate: t('statusSeparate'), convert: t('statusConvert'), mix: t('statusMix') }[s.stage] || t('statusSinging'));
  });
  window.chatApi.onSingDone((r) => {
    setStatus(t('statusSingDone'));
    const full = String((r && r.full) || '').replace(/\\/g, '/');
    const vocal = String((r && r.vocal) || '').replace(/\\/g, '/');
    addMsg('pet', tFmt('msgSingDone', { full, vocal }));
    if (r && r.full) {
      setPlayingName(String(r.name || '').replace(/\\/g, '/').split('/').pop() || t('fallbackSingName'));
      setPlayingUI(true); // 乐观：翻唱完成会自动播放
    }
  });
  window.chatApi.onSingError((e) => {
    setStatus(t('statusSingFail') + String(e || t('statusUnknown')), true);
    addMsg('pet', t('msgSingFail') + String(e || t('statusUnknown')));
  });
  // 菜单历史 / 翻唱面板历史：开始播放某首歌
  window.chatApi.onSingPlay((r) => {
    if (!r || !r.full) return;
    setStatus(t('statusPlayingSing'));
    const nm = String(r.name || '');
    setPlayingName(nm);
    setPlayingUI(true); // 乐观：收到播放指令即视为播放中（即使 sing-state 广播延迟/丢失，按钮也先显示 ⏸）
  });

  // ── 翻唱播放状态回显（playing/paused/ended）──
  window.chatApi.onSingState((s) => {
    if (!s) return;
    if (s === 'playing') { setPlayingUI(true); setStatus(''); }
    else if (s === 'paused') { setPlayingUI(false); setStatus(t('statusPaused')); }
    else if (s === 'ended') { setPlayingUI(false); setStatus(t('statusEnded')); np.classList.add('hidden'); }
  });

  // ── 最大化/还原（翻唱面板入口已由左侧导航承担）/ 最小化 / 关闭 ──
  const tbMax = $('#tbMax');
  let maxed = false;
  function refreshMax() {
    tbMax.textContent = maxed ? '❐' : '⛶';
    tbMax.title = maxed ? t('btnRestore') : t('btnMax');
  }
  tbMax.addEventListener('click', () => window.chatApi.maximize());
  window.chatApi.onMaxState((m) => { maxed = !!m; refreshMax(); });
  $('#tbMin').addEventListener('click', () => window.chatApi.minimize());
  $('#tbClose').addEventListener('click', () => window.chatApi.close());
  refreshMax();

  // 打开时向桌宠渲染层同步当前翻唱播放状态（避免按钮状态与翻唱面板不一致：播放中应显示 ⏸）
  window.chatApi.askState();

  // ── 历史回放：打开对话窗时拉取主进程记录（用户输入/猫姬回复/主动说话），
  // 主动说话时窗口未开也不丢失，重开可见完整对话
  window.chatApi.getHistory().then((list) => {
    if (!Array.isArray(list)) return;
    for (const m of list) addMsg(m.role === 'me' ? 'me' : 'pet', m.text);
  });

  // 语言切换后刷新所有 title（NECO_I18N 自动处理 data-i18n；动态按钮 title 需手动）
  window.addEventListener('i18n-change', () => {
    setSearchUI(btnSearch.classList.contains('on'));
    setCacheUI(cacheEnabled);
    setMuteUI(btnMute.classList.contains('on'));
  });
  window.NECO_I18N.init();
})();
