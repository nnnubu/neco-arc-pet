// 语音升级小窗：选框（点击选择/拖拽 zip）→ 安装进度条 + 分阶段文案 → 完成自动重启
(function () {
  const upDrop = document.getElementById('upDrop');
  const upDropIc = document.getElementById('upDropIc');
  const upDropHint = document.getElementById('upDropHint');
  const upDropBusy = document.getElementById('upDropBusy');
  const upDropPct = document.getElementById('upDropPct');
  const upProgress = document.getElementById('upProgress');
  const upFill = document.getElementById('upFill');
  const upStage = document.getElementById('upStage');
  const upErr = document.getElementById('upErr');
  let installing = false;

  function setBusy(pct) {
    // 选框整体转为"安装中"状态（转圈 + 百分比），并禁用点击（不能用 hidden——display:flex 会覆盖）
    upDrop.style.pointerEvents = 'none';
    upDrop.classList.add('busy');
    upDropIc.hidden = true;
    upDropHint.hidden = true;
    upDropBusy.hidden = false;
    upDropPct.textContent = (pct != null ? Math.round(pct) + '%' : '…');
  }
  function resetDrop() {
    upDrop.style.pointerEvents = '';
    upDrop.classList.remove('busy');
    upDropIc.hidden = false;
    upDropHint.hidden = false;
    upDropBusy.hidden = true;
  }

  document.getElementById('btnClose').addEventListener('click', () => window.masterApi.closeUpgradeWin());

  window.masterApi.onVoiceUpgrade((s) => {
    if (!s) return;
    if (s.state === 'unpacking') {
      installing = true;
      upErr.hidden = true;
      upProgress.hidden = false;
      if (s.total > 0) {
        const pct = Math.min(100, (s.done / s.total) * 100);
        upFill.style.width = Math.round(pct) + '%';
        upFill.classList.remove('indet');
        setBusy(pct);
      } else {
        upFill.classList.add('indet'); // 拿不到条目数：不确定进度动画
        setBusy(null);
      }
      const map = { 1: t('upgradeStage1'), 2: t('upgradeStage2'), 3: t('upgradeStage3') };
      upStage.textContent = map[s.stage || 1] || '';
    } else if (s.state === 'done') {
      upFill.style.width = '100%';
      upFill.classList.remove('indet');
      upStage.textContent = t('upgradeStageDone');
      setBusy(100);
    } else if (s.state === 'error') {
      installing = false;
      resetDrop();
      upProgress.hidden = true;
      upErr.hidden = false;
      const why = s.error === 'invalid' ? t('upgradeInvalid') : (s.error === 'already' ? t('upgradeAlready') : String(s.error || ''));
      upErr.textContent = t('upgradeFail') + why;
    }
  });

  // 选框：点击选择 / 拖拽 .zip 到选框（新版 Electron 无 File.path，须经 webUtils 取路径）
  upDrop.addEventListener('click', () => window.masterApi.pickVoiceUpgrade());
  upDrop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); upDrop.classList.add('drag'); });
  upDrop.addEventListener('dragleave', () => upDrop.classList.remove('drag'));
  upDrop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); upDrop.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.zip$/i.test(f.name)) return;
    const p = window.masterApi.getPathForFile ? window.masterApi.getPathForFile(f) : (f.path || '');
    if (!p) return;
    window.masterApi.upgradeVoiceWithPath(p);
  });
})();
