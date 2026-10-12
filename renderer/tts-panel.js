// TTS 语音面板渲染：文本 → 生成语音（参数可调）→ 历史播放
(function () {
  const $ = (s) => document.querySelector(s);
  const { t, tFmt } = window.NECO_I18N;
  const txt = $('#txtInput');
  const btnGen = $('#btnGen');
  const statusText = $('#statusText');
  const f0Slider = $('#f0Slider');
  const f0Val = $('#f0Val');
  const idxSlider = $('#idxSlider');
  const idxVal = $('#idxVal');
  const voiceSel = $('#voiceSel');
  const valenceSlider = $('#valenceSlider');
  const valenceVal = $('#valenceVal');
  const arousalSlider = $('#arousalSlider');
  const arousalVal = $('#arousalVal');
  const emotionTag = $('#emotionTag');
  const emotionIntensity = $('#emotionIntensity');
  const chkApplyChat = $('#chkApplyChat');
  const chkApplySing = $('#chkApplySing');
  const chkMeowClips = $('#chkMeowClips');
  const list = $('#historyList');
  let cfg = null;

  // ── 情绪量化：Valence-Arousal 二维模型 → 映射到 emotion + intensity（CosyVoice 情绪是文本指令，
  //    连续参数映射到最近情绪档，面板实时显示当前情绪与强度）──
  // 情绪标签文案按界面语言取（emoNeutral/emoHappy/emoAngry/emoSad/emoSurprised）
  function emotionLabel(e) { return t('emo' + e.charAt(0).toUpperCase() + e.slice(1)) || e; }
  function mapEmotion(v, a) {
    const vn = v / 100, an = a / 100; // v -1..1, a 0..1
    const c01 = (x) => Math.max(0.1, Math.min(1, x));
    if (an >= 0.65 && Math.abs(vn) <= 0.35) return { emotion: 'surprised', intensity: c01(an) };                 // 高活跃+中性 → 惊讶
    if (vn >= 0.25 && an >= 0.4) return { emotion: 'happy', intensity: c01((vn + an) / 2 + 0.25) };              // 正效价+高活跃 → 开心
    if (vn <= -0.25 && an >= 0.5) return { emotion: 'angry', intensity: c01((-vn + an) / 2 + 0.2) };             // 负效价+高活跃 → 生气
    if (vn <= -0.25) return { emotion: 'sad', intensity: c01((-vn + (1 - an)) / 2 + 0.3) };                      // 负效价+低活跃 → 难过
    if (vn >= 0.25) return { emotion: 'happy', intensity: c01(vn * 0.6 + 0.15) };                                // 正效价+低活跃 → 开心（弱）
    return { emotion: 'neutral', intensity: c01(0.35 + (1 - an) * 0.45) };                                        // 中效价 → 平静
  }
  function currentEmotion() {
    return mapEmotion(parseFloat(valenceSlider.value), parseFloat(arousalSlider.value));
  }
  function renderEmotionTag() {
    const m = currentEmotion();
    emotionTag.textContent = emotionLabel(m.emotion);
    emotionIntensity.textContent = tFmt('emoIntensity', { p: Math.round(m.intensity * 100) });
  }

  // 文本非空才允许生成
  txt.addEventListener('input', () => {
    btnGen.disabled = !txt.value.trim();
  });

  // ── 音色预设快捷（V0~V4 与之前音色测试一致）──
  function setPresetActive() {
    const f0 = parseFloat(f0Slider.value);
    const idx = parseFloat(idxSlider.value);
    document.querySelectorAll('.preset').forEach((b) => {
      const active = parseFloat(b.dataset.f0) === f0 && parseFloat(b.dataset.idx) === idx;
      b.classList.toggle('active', active);
    });
  }
  document.querySelectorAll('.preset').forEach((b) => {
    b.addEventListener('click', () => {
      f0Slider.value = b.dataset.f0;
      idxSlider.value = b.dataset.idx;
      f0Val.textContent = b.dataset.f0;
      idxVal.textContent = b.dataset.idx;
      setPresetActive();
      saveParams();
    });
  });

  // 滑杆/情绪变化：即时保存（生成时直接用当前值）
  function bindSlider(slider, valEl, fmt) {
    slider.addEventListener('input', () => {
      const v = fmt ? fmt(slider.value) : slider.value;
      valEl.textContent = v;
      setPresetActive();
      saveParams();
    });
  }
  bindSlider(f0Slider, f0Val, (v) => (parseFloat(v) > 0 ? '+' + v : v));
  bindSlider(idxSlider, idxVal);
  // 效价/活跃度：滑动即重算情绪标签 + 保存（含映射结果）
  function bindEmotionSlider(slider, valEl, fmt) {
    slider.addEventListener('input', () => {
      valEl.textContent = fmt ? fmt(slider.value) : slider.value;
      renderEmotionTag();
      saveParams();
    });
  }
  bindEmotionSlider(valenceSlider, valenceVal);
  bindEmotionSlider(arousalSlider, arousalVal);
  voiceSel.addEventListener('change', () => saveParams());
  chkApplyChat.addEventListener('change', () => saveParams());
  chkApplySing.addEventListener('change', () => saveParams());
  chkMeowClips.addEventListener('change', () => saveParams());

  // ── 自定义声线下拉：深色玻璃列表，与面板统一；原生 select 隐藏仅作 value 载体 ──
  const voiceWrap = $('#voiceWrap');
  const voiceBtn = $('#voiceBtn');
  const voiceList = $('#voiceList');
  const voiceBtnText = $('#voiceBtnText');
  function voiceLabel(v) {
    const opt = voiceSel.querySelector(`option[value="${CSS.escape(v)}"]`);
    return opt ? opt.textContent : t('voiceDefault');
  }
  function syncVoiceBtn() {
    voiceBtnText.textContent = voiceLabel(voiceSel.value);
    voiceList.querySelectorAll('.cs-item').forEach((it) => {
      it.classList.toggle('active', it.dataset.v === voiceSel.value);
    });
  }
  voiceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = voiceList.classList.contains('hidden');
    voiceList.classList.toggle('hidden', !opening);
    voiceBtn.classList.toggle('open', opening);
  });
  voiceList.querySelectorAll('.cs-item').forEach((it) => {
    it.addEventListener('click', (e) => {
      e.stopPropagation();
      voiceSel.value = it.dataset.v;
      syncVoiceBtn();
      voiceList.classList.add('hidden');
      voiceBtn.classList.remove('open');
      voiceSel.dispatchEvent(new Event('change')); // 复用现有 saveParams
    });
  });
  document.addEventListener('click', () => {
    voiceList.classList.add('hidden');
    voiceBtn.classList.remove('open');
  });

  function saveParams() {
    const m = currentEmotion();
    window.ttsPanelApi.save({
      f0: parseFloat(f0Slider.value),
      indexRate: parseFloat(idxSlider.value),
      emotion: m.emotion,          // 映射结果：voice_server 直接用
      intensity: m.intensity,      // 情绪强度（量化）
      valence: parseFloat(valenceSlider.value), // 原始量化参数（回填用）
      arousal: parseFloat(arousalSlider.value),
      voice: voiceSel.value,
      applyToChat: chkApplyChat.checked,
      applyToSing: chkApplySing.checked,
      meowClips: chkMeowClips.checked, // 口癖原版音频开关：开=遇到口癖用原版音频拼接；关=直接朗读
    });
  }

  // ── 生成 ──
  btnGen.addEventListener('click', async () => {
    const tv = txt.value.trim();
    if (!tv) return;
    const m = currentEmotion();
    btnGen.disabled = true;
    statusText.textContent = t('ttsGenning');
    const r = await window.ttsPanelApi.generate(tv, {
      f0: parseFloat(f0Slider.value),
      indexRate: parseFloat(idxSlider.value),
      emotion: m.emotion,
      voice: voiceSel.value,
      intensity: m.intensity,
    });
    if (!r || !r.ok) {
      statusText.textContent = t('ttsGenFail') + ((r && r.error) || t('statusUnknown'));
      btnGen.disabled = false;
      return;
    }
    statusText.textContent = t('ttsGenDone');
    $('#playingName').textContent = r.name || '';
    $('#playRow').classList.remove('hidden');
    btnGen.disabled = false;
    refreshHistory();
  });
  window.ttsPanelApi.onDone((r) => {
    statusText.textContent = t('ttsGenDone');
    if (r && r.name) {
      $('#playingName').textContent = r.name;
      $('#playRow').classList.remove('hidden');
    }
    refreshHistory();
  });
  window.ttsPanelApi.onError((e) => {
    statusText.textContent = t('ttsGenFail') + (e || t('statusUnknown'));
    btnGen.disabled = false;
  });

  // ── 播放/暂停（桌宠渲染层执行，这里发指令+回显状态；与翻唱共用 singAudio）──
  $('#btnToggle').addEventListener('click', () => window.ttsPanelApi.toggle());
  window.ttsPanelApi.onState((s) => {
    $('#btnToggle').textContent = s === 'playing' ? '⏸' : '▶';
    if (s === 'ended') statusText.textContent = t('ttsEnded');
    if (s === 'ended') setProgress(0, 0); // 播完/未播放：进度归零
  });

  // ── 播放进度条：进度上报更新 + 拖动 seek（仿歌词窗口）──
  const prog = $('#prog');
  const progFill = $('#progFill');
  const progKnob = $('#progKnob');
  const progTime = $('#progTime');
  let lastDur = 0; // 最近一次上报的总时长（拖动 seek 换算用）
  function fmt(t) {
    t = Math.max(0, Math.floor(Number(t) || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function setProgress(t, dur) {
    const d = Number(dur) || 0;
    if (d > 0) lastDur = d;
    const pct = d > 0 ? Math.max(0, Math.min(1, (Number(t) || 0) / d)) : 0;
    progFill.style.width = (pct * 100) + '%';
    progKnob.style.left = (pct * 100) + '%';
    progTime.textContent = fmt(t) + ' / ' + fmt(d);
  }
  window.ttsPanelApi.onProgress((p) => {
    if (p) setProgress(p.t, p.dur);
  });
  // 拖动 seek：按下即定位，拖动实时跟随，松开跳转
  let seeking = false;
  function seekFromEvent(e) {
    const r = prog.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    progFill.style.width = (pct * 100) + '%';
    progKnob.style.left = (pct * 100) + '%';
    return pct;
  }
  prog.addEventListener('pointerdown', (e) => {
    seeking = true;
    prog.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  prog.addEventListener('pointermove', (e) => {
    if (!seeking) return;
    seekFromEvent(e);
  });
  const finishSeek = (e) => {
    if (!seeking) return;
    seeking = false;
    try { prog.releasePointerCapture(e.pointerId); } catch (err) {}
    const pct = seekFromEvent(e);
    if (lastDur > 0) window.ttsPanelApi.seek(Math.round(pct * lastDur * 100) / 100);
  };
  prog.addEventListener('pointerup', finishSeek);
  prog.addEventListener('pointercancel', finishSeek);

  // 歌词重开入口（与翻唱共用桌面歌词窗口）
  $('#btnLyric').addEventListener('click', () => {
    window.ttsPanelApi.showLyric().then((ok) => {
      if (!ok) statusText.textContent = t('lyricNoLyric');
    });
  });

  // ── 初始化：载入配置 + 历史 ──
  async function init() {
    const data = await window.ttsPanelApi.load();
    // 无语音扩展包：顶部横幅引导（安装语音扩展包后重启解锁）
    const banner = $('#noVoiceBanner');
    if (!data.voiceEngine && banner) {
      banner.textContent = '⚠ ' + (data.noVoiceMsg || '未安装语音扩展包，语音合成不可用');
      banner.classList.remove('hidden');
      btnGen.disabled = true;
    }
    cfg = data.config;
    f0Slider.value = cfg.f0;
    f0Val.textContent = cfg.f0 > 0 ? '+' + cfg.f0 : String(cfg.f0);
    idxSlider.value = cfg.indexRate;
    idxVal.textContent = cfg.indexRate;
    // 量化参数回填（旧配置无 valence/arousal 时用默认 0/50 → 平静）
    valenceSlider.value = cfg.valence != null ? cfg.valence : 0;
    valenceVal.textContent = valenceSlider.value;
    arousalSlider.value = cfg.arousal != null ? cfg.arousal : 50;
    arousalVal.textContent = arousalSlider.value;
    renderEmotionTag();
    voiceSel.value = cfg.voice;
    syncVoiceBtn();
    chkApplyChat.checked = !!cfg.applyToChat;
    chkApplySing.checked = !!cfg.applyToSing;
    chkMeowClips.checked = cfg.meowClips !== false; // 旧配置无该字段默认开（保持映射行为）
    setPresetActive();
    refreshHistory();
  }
  function refreshHistory() {
    window.ttsPanelApi.load().then((data) => {
      const hist = data.history || [];
      list.innerHTML = '';
      if (!hist.length) {
        list.innerHTML = '<div class="hempty">' + t('ttsHistoryEmpty') + '</div>';
        return;
      }
      for (const h of hist) {
        const row = document.createElement('div');
        row.className = 'hitem';
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = h.name;
        const play = document.createElement('button');
        play.className = 'play';
        play.textContent = '▶';
        play.title = t('ttsPlay');
        play.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = await window.ttsPanelApi.play(h.name);
          if (r && r.ok) {
            $('#playingName').textContent = h.name;
            $('#playRow').classList.remove('hidden');
            statusText.textContent = t('ttsPlaying');
          } else {
            statusText.textContent = t('ttsPlayFail') + ((r && r.error) || t('statusUnknown'));
          }
        });
        row.appendChild(nm);
        row.appendChild(play);
        list.appendChild(row);
      }
    });
  }

  // 语言切换：情绪标签/声线按钮文字/历史列表刷新（data-i18n 自动应用）
  window.addEventListener('i18n-change', () => {
    renderEmotionTag();
    syncVoiceBtn();
    refreshHistory();
    const banner = $('#noVoiceBanner');
    if (banner && !banner.classList.contains('hidden')) {
      window.ttsPanelApi.load().then((d) => {
        if (d && d.noVoiceMsg) banner.textContent = '⚠ ' + d.noVoiceMsg;
      });
    }
  });

  // 标题栏按钮
  $('#btnMin').addEventListener('click', () => window.ttsPanelApi.minimize());
  $('#btnClose').addEventListener('click', () => window.ttsPanelApi.close());
  $('#btnDir').addEventListener('click', () => window.ttsPanelApi.openDir());

  window.NECO_I18N.init().then(() => init());
})();
