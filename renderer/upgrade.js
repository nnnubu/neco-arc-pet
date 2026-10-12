// 语音升级小窗：选框（点击选择/拖拽 zip）→ 安装进度条 + 分阶段文案 → 完成自动重启
(function () {
  const { t } = window.NECO_I18N;
  // 必须显式 init 拉取语言表——否则 state.dict 一直为空，t() 全部返回键名
  window.NECO_I18N.init();
  const upDrop = document.getElementById('upDrop');
  const upDropIc = document.getElementById('upDropIc');
  const upDropHint = document.getElementById('upDropHint');
  const upDropBusy = document.getElementById('upDropBusy');
  const upDropPct = document.getElementById('upDropPct');
  const upProgress = document.getElementById('upProgress');
  const upFill = document.getElementById('upFill');
  const upStage = document.getElementById('upStage');
  const upPct = document.getElementById('upPct');
  const upErr = document.getElementById('upErr');
  // 已安装态：状态区 + 卸载按钮
  const upInstalled = document.getElementById('upInstalled');
  const btnUninstall = document.getElementById('btnUninstall');
  const upUninstallBusy = document.getElementById('upUninstallBusy');
  const upUninstallTxt = document.getElementById('upUninstallTxt');
  const upTitle = document.getElementById('upTitle');
  let installing = false;
  let uninstalling = false;

  // 当前界面模式：install=安装引导 / manage=卸载管理（语言切换时重设标题）
  let mode = 'install';
  function applyTitle() {
    upTitle.textContent = mode === 'manage' ? t('upgradeTitleInstalled') : t('upgradeTitle');
  }
  // 阶段/状态文案：记录当前 stage，语言表就绪或切换时重刷（dict 未就绪时 t() 会返回键名）
  let stageTxt = '';
  function applyStage() {
    if (stageTxt) upStage.textContent = stageTxt;
  }
  function setStage(keyOrText) {
    stageTxt = t(keyOrText);
    upStage.textContent = stageTxt;
  }
  // 打开时按语音包状态切换界面：无语音=安装引导；有语音=卸载管理（互斥）
  window.masterApi.getVoiceStatus().then((s) => {
    mode = s && s.hasVoice ? 'manage' : 'install';
    upDrop.hidden = mode !== 'install';
    upProgress.hidden = true;
    upInstalled.hidden = mode !== 'manage';
    upErr.hidden = true;
    applyTitle();
  });
  window.addEventListener('i18n-change', () => { applyTitle(); applyStage(); });

  // 自绘确认模态（不用原生 window.confirm——样式无法统一）
  const upModal = document.getElementById('upModal');
  const upModalTxt = document.getElementById('upModalTxt');
  const upModalOk = document.getElementById('upModalOk');
  const upModalCancel = document.getElementById('upModalCancel');
  function askUninstall() {
    upModalTxt.textContent = t('upgradeUninstallConfirm');
    upModal.hidden = false;
  }
  upModalOk.addEventListener('click', () => {
    if (uninstalling) return;
    upModal.hidden = true;
    uninstalling = true;
    btnUninstall.hidden = true;
    upUninstallBusy.hidden = false;
    upUninstallTxt.textContent = t('upgradeUninstalling');
    window.masterApi.uninstallVoice();
  });
  upModalCancel.addEventListener('click', () => { upModal.hidden = true; });
  // 卸载按钮：先弹自绘确认
  btnUninstall.addEventListener('click', () => {
    if (uninstalling) return;
    askUninstall();
  });

  function setBusy(pct) {
    // 选框整体转为"安装中"状态（转圈 + 百分比），并禁用点击（不能用 hidden——display:flex 会覆盖）
    upDrop.style.pointerEvents = 'none';
    upDrop.classList.add('busy');
    upDropIc.hidden = true;
    upDropHint.hidden = true;
    upDropBusy.hidden = false;
    upDropPct.textContent = (pct != null ? Math.round(pct) + '%' : '…');
  }
  function setPct(pct) {
    // 底部进度条旁的数字百分比（与选框同步）
    upPct.textContent = (pct != null ? Math.round(pct) + '%' : '');
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
        setPct(pct);
      } else {
        upFill.classList.add('indet'); // 拿不到条目数：不确定进度动画
        setBusy(null);
        setPct(null);
      }
      const map = { 1: t('upgradeStage1'), 2: t('upgradeStage2'), 3: t('upgradeStage3') };
      setStage(map[s.stage || 1] || '');
    } else if (s.state === 'done') {
      upFill.style.width = '100%';
      upFill.classList.remove('indet');
      setStage('upgradeStageDone');
      setBusy(100);
      setPct(100);
    } else if (s.state === 'uninstalling') {
      // 卸载中：进度条转不确定动画，禁用选框
      upProgress.hidden = false;
      upFill.classList.add('indet');
      setStage('upgradeUninstalling');
      upInstalled.hidden = true;
      setBusy(null);
      setPct(null);
    } else if (s.state === 'uninstalled') {
      upFill.classList.remove('indet');
      setStage('upgradeUninstalled');
      setBusy(100);
      setPct(100);
    } else if (s.state === 'error') {
      installing = false;
      resetDrop();
      upProgress.hidden = true;
      upErr.hidden = false;
      setPct(null);
      // 卸载失败：恢复卸载按钮
      if (uninstalling) {
        uninstalling = false;
        btnUninstall.hidden = false;
        upUninstallBusy.hidden = true;
      }
      const why = s.error === 'invalid' ? t('upgradeInvalid') : (s.error === 'already' ? t('upgradeAlready') : (s.error === 'not-installed' ? t('upgradeNotInstalled') : String(s.error || '')));
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
