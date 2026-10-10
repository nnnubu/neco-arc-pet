// 翻唱面板渲染：拖拽/选择音频 → 开始翻唱 → 步骤进度 → 播放控制 + 历史列表
(function () {
  const $ = (s) => document.querySelector(s);
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
    picked.textContent = '已选择：' + p;
    btnStart.disabled = false;
    statusText.textContent = '';
    resetSteps();
  }

  // ── 开始翻唱 ──
  btnStart.addEventListener('click', () => {
    if (!currentFile) return;
    window.singPanelApi.startSing(currentFile);
    statusText.textContent = '已提交，正在处理…';
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
    statusText.textContent = { separate: '正在分离人声…', convert: '正在变声成喵声…', mix: '正在混音…' }[s.stage] || '翻唱中…';
    if (s.stage === 'separate') mark('sep', 'on');
    if (s.stage === 'convert') { mark('sep', 'done'); mark('cvt', 'on'); $('#barFill').style.width = '45%'; }
    if (s.stage === 'mix') { mark('cvt', 'done'); mark('mix', 'on'); $('#barFill').style.width = '80%'; }
  });
  function mark(k, cls) { const e = $('#st-' + k); if (e) e.className = 'step ' + cls; }

  // ── 完成 / 错误 ──
  window.singPanelApi.onDone((r) => {
    mark('mix', 'done');
    $('#barFill').style.width = '100%';
    statusText.textContent = '翻唱完成，正在播放喵！';
    btnStart.disabled = false; // 处理结束：允许再翻唱下一首
    playingName = r.full ? String(r.full).split(/[\\/]/).pop() : '';
    $('#playingName').textContent = playingName;
    $('#playRow').classList.remove('hidden');
    refreshHistory();
  });
  window.singPanelApi.onError((e) => {
    statusText.textContent = '翻唱失败：' + (e || '未知');
    btnStart.disabled = false;
    resetSteps();
  });

  // ── 播放/暂停控制（桌宠渲染层执行播放；这里只发指令 + 回显状态）──
  $('#btnToggle').addEventListener('click', () => window.singPanelApi.toggle());
  window.singPanelApi.onState((s) => {
    $('#btnToggle').textContent = s === 'playing' ? '⏸' : '▶';
    if (s === 'ended') statusText.textContent = '播放结束';
  });

  // ── 桌面歌词重开入口（歌词窗口被关闭后可再次打开）──
  $('#btnLyric').addEventListener('click', () => {
    window.singPanelApi.showLyric().then((ok) => {
      if (!ok) statusText.textContent = '暂无歌词可显示';
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
      else if (r && r.error) statusText.textContent = '歌词文件读取失败：' + r.error;
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
      else if (r && r.error) statusText.textContent = '歌词文件读取失败：' + r.error;
    });
  });

  // 广播 sing-play（菜单历史 / 歌词窗"下一首" / 面板播放）→ 同步"正在播放"歌名
  window.singPanelApi.onSingPlay((r) => {
    if (!r || !r.name) return;
    $('#playingName').textContent = r.name;
    $('#playRow').classList.remove('hidden');
    statusText.textContent = '正在播放…';
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
        list.innerHTML = '<div class="hempty">还没有翻唱记录</div>';
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
        play.addEventListener('click', (e) => {
          e.stopPropagation();
          window.singPanelApi.play(h.name);
          $('#playingName').textContent = h.name;
          $('#playRow').classList.remove('hidden');
          statusText.textContent = '正在播放…';
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

  refreshHistory();
})();
