/* 对话窗口渲染：消息气泡 + 输入发送 + 状态显示 + 翻唱播放控制
 * 数据全部来自主进程广播（voice.js/sing.js broadcast → 桌宠窗 + 对话窗）
 * 桌宠窗负责音频播放与透明文字逐字，本窗口只做对话交互显示 */
(function () {
  const $ = (s) => document.querySelector(s);
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
    r.textContent = role === 'me' ? '你' : '猫姬';
    const body = document.createElement('span');
    body.textContent = text;
    d.appendChild(r);
    d.appendChild(body);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    if (role === 'pet') lastPetMsg = d;
    return d;
  }

  // ── 发送 / 重试 ──
  function send(force) {
    const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
    if (!t) return;
    addMsg('me', t);
    input.value = '';
    setStatus(force ? '重新合成中喵…' : '喵…思考中');
    window.chatApi.sendText(t, force);
  }
  $('#btnSend').addEventListener('click', () => send(false));
  $('#btnRetry').addEventListener('click', () => send(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(false);
  });

  // ── 联网搜索开关（状态持久化在主进程 ai 配置，打开时高亮）──
  const btnSearch = $('#btnSearch');
  function setSearchUI(on) {
    btnSearch.classList.toggle('on', !!on);
    btnSearch.title = on ? '联网搜索：开（最新/实时问题自动搜索）' : '联网搜索：关（点击开启）';
  }
  window.chatApi.searchState().then(setSearchUI);
  btnSearch.addEventListener('click', async () => {
    const next = await window.chatApi.toggleSearch();
    setSearchUI(next);
  });

  // ── 语音问答状态 ──
  window.chatApi.onSpeakState((s) => {
    if (!s) return;
    if (s.state === 'ai') {
      // 提问开始：立即创建猫姬回复气泡（后续流式 token 累积写入；之前 lastPetMsg 为 null 导致回复不显示）
      setStatus('喵…思考中');
      replyText = '';
      addMsg('pet', '');
      lastPetMsg.lastChild.textContent = '';
    }
    else if (s.state === 'generating') { setStatus('生成语音中…'); }
    else if (s.state === 'done') { setStatus(''); }
    else if (s.state === 'error') {
      setStatus('出错了：' + (s.error || '未知'), true);
      addMsg('pet', '出错了喵：' + (s.error || '未知'));
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
    setStatus({ separate: '正在分离人声…', convert: '正在变声成喵声…', mix: '正在混音…' }[s.stage] || '翻唱中…');
  });
  window.chatApi.onSingDone((r) => {
    setStatus('翻唱完成喵！');
    const full = String((r && r.full) || '').replace(/\\/g, '/');
    const vocal = String((r && r.vocal) || '').replace(/\\/g, '/');
    addMsg('pet', '唱好啦喵！\n完整版：' + full + '\n人声轨：' + vocal);
    if (r && r.full) {
      setPlayingName(String(r.name || '').replace(/\\/g, '/').split('/').pop() || '翻唱');
      setPlayingUI(true); // 乐观：翻唱完成会自动播放
    }
  });
  window.chatApi.onSingError((e) => {
    setStatus('翻唱失败：' + String(e || '未知'), true);
    addMsg('pet', '翻唱失败喵：' + String(e || '未知'));
  });
  // 菜单历史 / 翻唱面板历史：开始播放某首歌
  window.chatApi.onSingPlay((r) => {
    if (!r || !r.full) return;
    setStatus('播放翻唱…');
    const nm = String(r.name || '');
    setPlayingName(nm);
    setPlayingUI(true); // 乐观：收到播放指令即视为播放中（即使 sing-state 广播延迟/丢失，按钮也先显示 ⏸）
  });

  // ── 翻唱播放状态回显（playing/paused/ended）──
  window.chatApi.onSingState((s) => {
    if (!s) return;
    if (s === 'playing') { setPlayingUI(true); setStatus(''); }
    else if (s === 'paused') { setPlayingUI(false); setStatus('已暂停'); }
    else if (s === 'ended') { setPlayingUI(false); setStatus('播放结束'); np.classList.add('hidden'); }
  });

  // ── 翻唱面板入口 / 最小化 / 关闭（播放控制统一在翻唱面板）──
  $('#tbSing').addEventListener('click', () => window.chatApi.openSingPanel());
  $('#tbMin').addEventListener('click', () => window.chatApi.minimize());
  $('#tbClose').addEventListener('click', () => window.chatApi.close());

  // 打开时向桌宠渲染层同步当前翻唱播放状态（避免按钮状态与翻唱面板不一致：播放中应显示 ⏸）
  window.chatApi.askState();

  // ── 历史回放：打开对话窗时拉取主进程记录（用户输入/猫姬回复/主动说话），
  // 主动说话时窗口未开也不丢失，重开可见完整对话
  window.chatApi.getHistory().then((list) => {
    if (!Array.isArray(list)) return;
    for (const m of list) addMsg(m.role === 'me' ? 'me' : 'pet', m.text);
  });
})();
