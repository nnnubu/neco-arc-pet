// 语音升级小窗：选框（点击选择/拖拽 zip）→ 安装进度条 + 分阶段文案 → 完成自动重启
(function () {
  const upDrop = document.getElementById('upDrop');
  const upProgress = document.getElementById('upProgress');
  const upFill = document.getElementById('upFill');
  const upStage = document.getElementById('upStage');
  const upErr = document.getElementById('upErr');
  let installing = false;

  document.getElementById('btnClose').addEventListener('click', () => window.masterApi.closeUpgradeWin());

  window.masterApi.onVoiceUpgrade((s) => {
    if (!s) return;
    if (s.state === 'unpacking') {
      installing = true;
      upDrop.hidden = true;
      upErr.hidden = true;
      upProgress.hidden = false;
      if (s.total > 0) {
        const pct = Math.min(100, Math.round((s.done / s.total) * 100));
        upFill.style.width = pct + '%';
        upFill.classList.remove('indet');
      } else {
        upFill.classList.add('indet'); // 拿不到条目数：不确定进度动画
      }
      const map = { 1: t('upgradeStage1'), 2: t('upgradeStage2'), 3: t('upgradeStage3') };
      upStage.textContent = map[s.stage || 1] || '';
    } else if (s.state === 'done') {
      upFill.style.width = '100%';
      upStage.textContent = t('upgradeStageDone');
    } else if (s.state === 'error') {
      installing = false;
      upDrop.hidden = false;
      upProgress.hidden = true;
      upErr.hidden = false;
      const why = s.error === 'invalid' ? t('upgradeInvalid') : (s.error === 'already' ? t('upgradeAlready') : String(s.error || ''));
      upErr.textContent = t('upgradeFail') + why;
    }
  });

  // 选框：点击选择 / 拖拽 .zip 到选框
  upDrop.addEventListener('click', () => window.masterApi.pickVoiceUpgrade());
  upDrop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); upDrop.classList.add('drag'); });
  upDrop.addEventListener('dragleave', () => upDrop.classList.remove('drag'));
  upDrop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); upDrop.classList.remove('drag');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.zip$/i.test(f.name)) return;
    window.masterApi.upgradeVoiceWithPath(f.path);
  });
})();
