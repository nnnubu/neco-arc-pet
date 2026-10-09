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
