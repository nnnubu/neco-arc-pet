// 翻唱面板渲染：拖拽/选择音频 → 开始翻唱 → 步骤进度 → 播放控制 + 历史列表
(function () {
  const $ = (s) => document.querySelector(s);
  const { t } = window.NECO_I18N;
  const drop = $('#dropZone');
  const picked = $('#picked');
  const btnStart = $('#btnStart');
  const statusText = $('#statusText');
  const list = $('#historyList');
  let currentFile = null;
  let playingName = '';

  // ── 拖拽 / 点击选择音频 ──
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    // sandbox 渲染进程里 f.path 不可用（点击选择是主进程 dialog 返回路径所以正常）——
    // 拖拽必须用 webUtils.getPathForFile 取真实路径
    const p = window.singPanelApi.getPathForFile(f);
    if (p) selectFile(p);
  });
  drop.addEventListener('click', async () => {
    const p = await window.singPanelApi.pickFile();
    if (p) selectFile(p);
  });

  function selectFile(p) {
    currentFile = p;
    picked.style.display = 'block';
    picked.textContent = t('singPicked') + p;
    btnStart.disabled = false;
    statusText.textContent = '';
    resetSteps();
  }

  // ── 开始翻唱 ──
  btnStart.addEventListener('click', () => {
    if (!currentFile) return;
    window.singPanelApi.startSing(currentFile);
    statusText.textContent = t('singSubmitted');
    btnStart.disabled = true; // 处理中禁止重复点击（一次只翻唱一首）
  });

  // ── 进度步骤 ──
  function resetSteps() {
    ['sep', 'cvt', 'mix'].forEach((k) => {
      $('#st-' + k).className = 'step';
    });
    $('#barFill').style.width = '0%';
  }
  window.singPanelApi.onProgress((s) => {
    statusText.textContent = { separate: t('singStageSep'), convert: t('singStageCvt'), mix: t('singStageMix') }[s.stage] || t('singStageRun');
    if (s.stage === 'separate') mark('sep', 'on');
    if (s.stage === 'convert') { mark('sep', 'done'); mark('cvt', 'on'); $('#barFill').style.width = '45%'; }
    if (s.stage === 'mix') { mark('cvt', 'done'); mark('mix', 'on'); $('#barFill').style.width = '80%'; }
  });
  function mark(k, cls) { const e = $('#st-' + k); if (e) e.className = 'step ' + cls; }

  // ── 完成 / 错误 ──
  window.singPanelApi.onDone((r) => {
    mark('mix', 'done');
    $('#barFill').style.width = '100%';
    statusText.textContent = t('singDone');
    btnStart.disabled = false; // 处理结束：允许再翻唱下一首
    playingName = r.full ? String(r.full).split(/[\\/]/).pop() : '';
    $('#playingName').textContent = playingName;
    $('#playRow').classList.remove('hidden');
    refreshHistory();
  });
  window.singPanelApi.onError((e) => {
    statusText.textContent = t('singFail') + (e || t('statusUnknown'));
    btnStart.disabled = false;
    resetSteps();
  });

  // ── 播放/暂停控制（桌宠渲染层执行播放；这里只发指令 + 回显状态）──
  $('#btnToggle').addEventListener('click', () => window.singPanelApi.toggle());

  // 翻唱音量滑块：实时发送到桌宠窗（singAudio.volume），本地记忆显示
  const volSlider = $('#volSlider');
  const volVal = $('#volVal');
  volSlider.addEventListener('input', () => {
    const v = Math.round(volSlider.value);
    volVal.textContent = v + '%';
    window.singPanelApi.setVolume(v / 100);
  });
  window.singPanelApi.onState((s) => {
    $('#btnToggle').textContent = s === 'playing' ? '⏸' : '▶';
    if (s === 'ended') statusText.textContent = t('singEnded');
  });

  // ── 桌面歌词重开入口（歌词窗口被关闭后可再次打开）──
  $('#btnLyric').addEventListener('click', () => {
    window.singPanelApi.showLyric().then((ok) => {
      if (!ok) statusText.textContent = t('lyricNoLyric');
    });
  });

  // ── 歌词文件：勾选后显示选框；点击选择 / 拖拽上传（播放时优先使用该歌词）──
  const chkLrc = $('#chkLrc');
  const lrcZone = $('#lrcZone');
  const lrcPicked = $('#lrcPicked');
  const lrcHint = $('#lrcHint');
  chkLrc.addEventListener('change', () => {
    lrcZone.classList.toggle('hidden', !chkLrc.checked);
    if (!chkLrc.checked) {
      // 取消勾选：清空已选歌词文件
      window.singPanelApi.setLrcFile('').then(() => {
        lrcPicked.textContent = '';
        lrcHint.style.display = '';
      });
    }
  });
  function showLrc(picked) {
    lrcPicked.textContent = picked.name || '';
    lrcHint.style.display = picked.name ? 'none' : '';
  }
  // 当前正在播放/显示的歌（选歌词文件时绑定，只对这首歌生效）
  function currentSong() {
    const nm = document.getElementById('playingName');
    return (nm && nm.textContent.trim()) ? nm.textContent.trim() : '';
  }
  lrcZone.addEventListener('click', () => {
    window.singPanelApi.pickLrc(currentSong()).then((r) => {
      if (r && r.ok) showLrc(r);
      else if (r && r.error) statusText.textContent = t('singLrcFail') + r.error;
    });
  });
  lrcZone.addEventListener('dragover', (e) => { e.preventDefault(); });
  lrcZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const p = window.singPanelApi.getPathForFile(f);
    window.singPanelApi.setLrcFile(p, currentSong()).then((r) => {
      if (r && r.ok) showLrc(r);
      else if (r && r.error) statusText.textContent = t('singLrcFail') + r.error;
    });
  });

  // 广播 sing-play（菜单历史 / 歌词窗"下一首" / 面板播放）→ 同步"正在播放"歌名
  window.singPanelApi.onSingPlay((r) => {
    if (!r || !r.name) return;
    $('#playingName').textContent = r.name;
    $('#playRow').classList.remove('hidden');
    statusText.textContent = t('singPlaying');
  });

  // 歌词文件被自动清空（切歌到未绑定歌曲时）：同步取消勾选 + 隐藏选框
  window.singPanelApi.onLrcCleared(() => {
    chkLrc.checked = false;
    lrcZone.classList.add('hidden');
    lrcPicked.textContent = '';
    lrcHint.style.display = '';
  });

  // ── 历史列表 ──
  function refreshHistory() {
    window.singPanelApi.getHistory().then((hist) => {
      list.innerHTML = '';
      if (!hist || !hist.length) {
        list.innerHTML = '<div class="hempty">' + t('singHistoryEmpty') + '</div>';
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
        play.title = t('singPlay');
        play.addEventListener('click', (e) => {
          e.stopPropagation();
          window.singPanelApi.play(h.name);
          $('#playingName').textContent = h.name;
          $('#playRow').classList.remove('hidden');
          statusText.textContent = t('singPlaying');
        });
        row.appendChild(nm);
        row.appendChild(play);
        list.appendChild(row);
      }
    });
  }

  // ── 最小化 / 关闭 / 打开文件夹 ──
  $('#btnMin').addEventListener('click', () => window.singPanelApi.minimize());
  $('#btnClose').addEventListener('click', () => window.singPanelApi.close());
  $('#btnDir').addEventListener('click', () => window.singPanelApi.openDir());

  // ── 桌面歌词颜色（配置化，默认当前亮黄 #ffd04d）：选色即保存，下次播放歌词生效 ──
  const lyricColor = $('#lyricColor');
  window.singPanelApi.getLyricColor().then((c) => {
    lyricColor.value = /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#ffd04d';
  });
  lyricColor.addEventListener('input', () => window.singPanelApi.setLyricColor(lyricColor.value));
  $('#btnLyricColorReset').addEventListener('click', () => {
    lyricColor.value = '#ffd04d';
    window.singPanelApi.setLyricColor('#ffd04d');
  });

  // ── 无语音扩展包：顶部横幅引导 + 禁用开始翻唱（安装语音包后重启解锁）──
  function refreshNoVoiceBanner() {
    window.singPanelApi.getEngine().then((r) => {
      const banner = $('#noVoiceBanner');
      if (r && !r.voiceEngine && banner) {
        banner.textContent = '⚠ ' + (r.noVoiceMsg || t('noVoiceMsg'));
        banner.classList.remove('hidden');
        $('#btnStart').disabled = true;
      }
    });
  }
  refreshNoVoiceBanner();

  // 语言切换：历史列表/横幅刷新（data-i18n 自动应用）
  window.addEventListener('i18n-change', () => {
    refreshHistory();
    refreshNoVoiceBanner();
  });
  window.NECO_I18N.init();
  refreshHistory();
})();
