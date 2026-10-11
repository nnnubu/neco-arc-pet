// TTS 语音面板渲染：文本 → 生成语音（参数可调）→ 历史播放
(function () {
  const $ = (s) => document.querySelector(s);
  const txt = $('#txtInput');
  const btnGen = $('#btnGen');
  const statusText = $('#statusText');
  const f0Slider = $('#f0Slider');
  const f0Val = $('#f0Val');
  const idxSlider = $('#idxSlider');
  const idxVal = $('#idxVal');
  const emotionSel = $('#emotionSel');
  const voiceSel = $('#voiceSel');
  const intensitySlider = $('#intensitySlider');
  const intensityVal = $('#intensityVal');
  const list = $('#historyList');
  let cfg = null;

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
  bindSlider(intensitySlider, intensityVal, (v) => Math.round(parseFloat(v) * 100) + '%');
  emotionSel.addEventListener('change', () => saveParams());
  voiceSel.addEventListener('change', () => saveParams());

  function saveParams() {
    window.ttsPanelApi.save({
      f0: parseFloat(f0Slider.value),
      indexRate: parseFloat(idxSlider.value),
      emotion: emotionSel.value,
      voice: voiceSel.value,
      intensity: parseFloat(intensitySlider.value),
    });
  }

  // ── 生成 ──
  btnGen.addEventListener('click', async () => {
    const t = txt.value.trim();
    if (!t) return;
    btnGen.disabled = true;
    statusText.textContent = '正在生成语音…';
    const r = await window.ttsPanelApi.generate(t, {
      f0: parseFloat(f0Slider.value),
      indexRate: parseFloat(idxSlider.value),
      emotion: emotionSel.value,
      voice: voiceSel.value,
      intensity: parseFloat(intensitySlider.value),
    });
    if (!r || !r.ok) {
      statusText.textContent = '生成失败：' + ((r && r.error) || '未知错误');
      btnGen.disabled = false;
      return;
    }
    statusText.textContent = '生成完成，正在播放喵！';
    $('#playingName').textContent = r.name || '';
    $('#playRow').classList.remove('hidden');
    btnGen.disabled = false;
    refreshHistory();
  });
  window.ttsPanelApi.onDone((r) => {
    statusText.textContent = '生成完成，正在播放喵！';
    if (r && r.name) {
      $('#playingName').textContent = r.name;
      $('#playRow').classList.remove('hidden');
    }
    refreshHistory();
  });
  window.ttsPanelApi.onError((e) => {
    statusText.textContent = '生成失败：' + (e || '未知');
    btnGen.disabled = false;
  });

  // ── 播放/暂停（桌宠渲染层执行，这里发指令+回显状态；与翻唱共用 singAudio）──
  $('#btnToggle').addEventListener('click', () => window.ttsPanelApi.toggle());
  window.ttsPanelApi.onState((s) => {
    $('#btnToggle').textContent = s === 'playing' ? '⏸' : '▶';
    if (s === 'ended') statusText.textContent = '播放结束';
  });

  // 歌词重开入口（与翻唱共用桌面歌词窗口）
  $('#btnLyric').addEventListener('click', () => {
    window.ttsPanelApi.showLyric().then((ok) => {
      if (!ok) statusText.textContent = '暂无歌词可显示';
    });
  });

  // ── 初始化：载入配置 + 历史 ──
  async function init() {
    const data = await window.ttsPanelApi.load();
    cfg = data.config;
    f0Slider.value = cfg.f0;
    f0Val.textContent = cfg.f0 > 0 ? '+' + cfg.f0 : String(cfg.f0);
    idxSlider.value = cfg.indexRate;
    idxVal.textContent = cfg.indexRate;
    intensitySlider.value = cfg.intensity;
    intensityVal.textContent = Math.round(cfg.intensity * 100) + '%';
    emotionSel.value = cfg.emotion;
    voiceSel.value = cfg.voice;
    setPresetActive();
    refreshHistory();
  }
  function refreshHistory() {
    window.ttsPanelApi.load().then((data) => {
      const hist = data.history || [];
      list.innerHTML = '';
      if (!hist.length) {
        list.innerHTML = '<div class="hempty">还没有生成记录</div>';
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
        play.title = '播放';
        play.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = await window.ttsPanelApi.play(h.name);
          if (r && r.ok) {
            $('#playingName').textContent = h.name;
            $('#playRow').classList.remove('hidden');
            statusText.textContent = '正在播放…';
          } else {
            statusText.textContent = '播放失败：' + ((r && r.error) || '未知');
          }
        });
        row.appendChild(nm);
        row.appendChild(play);
        list.appendChild(row);
      }
    });
  }

  // 标题栏按钮
  $('#btnMin').addEventListener('click', () => window.ttsPanelApi.minimize());
  $('#btnClose').addEventListener('click', () => window.ttsPanelApi.close());
  $('#btnDir').addEventListener('click', () => window.ttsPanelApi.openDir());

  init();
})();
