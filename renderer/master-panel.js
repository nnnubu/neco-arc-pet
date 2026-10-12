// 总面板渲染层：导航点击切换模块 + 最小化/关闭 + 高亮当前模块
const { t } = window.NECO_I18N;
const items = Array.from(document.querySelectorAll('.nav-item'));

function setActive(name) {
  items.forEach((b) => b.classList.toggle('active', b.dataset.mod === name));
}

items.forEach((b) => {
  b.addEventListener('click', () => {
    setActive(b.dataset.mod);
    window.masterApi.nav(b.dataset.mod);
  });
});

// 最小化/关闭由窗口右上角控制按钮承担（master-panel.js 渲染层不再绑定 navFoot 的 —/×）
// 最大化/还原：点击切换；主进程推送当前状态同步按钮文字（"最大化"/"还原"），语言切换时按保存状态重刷
const btnMax = document.getElementById('btnMax');
let maxed = false;
function refreshMaxBtn() {
  btnMax.textContent = maxed ? t('btnRestore') : t('btnMax');
  btnMax.title = maxed ? t('btnRestore') : t('btnMax');
}
btnMax.addEventListener('click', () => window.masterApi.maximize());
window.masterApi.onMaxState((m) => { maxed = !!m; refreshMaxBtn(); });
window.addEventListener('i18n-change', refreshMaxBtn);

// ── 语音升级：基础包（无语音扩展包）时隐藏 翻唱/语音合成 导航，标题栏 ⬆ 打开安装弹窗 ──
const upgradeBtn = document.getElementById('btnUpgrade');
const upgradeModal = document.getElementById('upgradeModal');
const upDrop = document.getElementById('upDrop');
const upProgress = document.getElementById('upProgress');
const upFill = document.getElementById('upFill');
const upStage = document.getElementById('upStage');
const upErr = document.getElementById('upErr');
const upClose = document.getElementById('upClose');
let installing = false;

function applyVoiceUI(hasVoice) {
  // 有语音包 → 显示 翻唱/语音合成；无语音包（基础包）→ 隐藏并显示升级按钮
  // 注意：不能用 hidden 属性——.nav-item 有显式 display:flex 会覆盖 hidden，必须用 inline style
  document.querySelectorAll('.nav-item[data-voice]').forEach((b) => { b.style.display = hasVoice ? '' : 'none'; });
  upgradeBtn.hidden = !!hasVoice;
  if (hasVoice) closeUpgradeModal();
}
window.masterApi.getVoiceStatus().then((s) => applyVoiceUI(!!(s && s.hasVoice)));

function closeUpgradeModal() {
  if (installing) return; // 安装中不允许关闭（避免半装状态）
  upgradeModal.hidden = true;
}
function openUpgradeModal() {
  if (installing) return; // 安装中：仅显示进度，不重置选框
  upDrop.hidden = false;
  upProgress.hidden = true;
  upErr.hidden = true;
  upClose.hidden = false;
  upgradeModal.hidden = false;
}
upgradeBtn.addEventListener('click', openUpgradeModal);
upClose.addEventListener('click', closeUpgradeModal);

function setUpgradeStage(stage) {
  const map = { 1: t('upgradeStage1'), 2: t('upgradeStage2'), 3: t('upgradeStage3') };
  upStage.textContent = map[stage] || '';
}
window.masterApi.onVoiceUpgrade((s) => {
  if (!s) return;
  if (s.state === 'unpacking') {
    installing = true;
    upDrop.hidden = true;
    upClose.hidden = true;
    upErr.hidden = true;
    upProgress.hidden = false;
    if (s.total > 0) {
      const pct = Math.min(100, Math.round((s.done / s.total) * 100));
      upFill.style.width = pct + '%';
      upFill.classList.remove('indet');
    } else {
      upFill.classList.add('indet'); // 拿不到条目数：不确定进度动画
    }
    setUpgradeStage(s.stage || 1);
  } else if (s.state === 'done') {
    upFill.style.width = '100%';
    upStage.textContent = t('upgradeStageDone');
  } else if (s.state === 'error') {
    installing = false;
    upDrop.hidden = false;
    upClose.hidden = false;
    upProgress.hidden = true;
    upErr.hidden = false;
    const why = s.error === 'invalid' ? t('upgradeInvalid') : (s.error === 'already' ? t('upgradeAlready') : String(s.error || ''));
    upErr.textContent = t('upgradeFail') + why;
  }
});

// 弹窗选框：点击选择 / 拖拽 .zip 到选框（窗口任意处拖拽亦可直接开始安装）
upDrop.addEventListener('click', () => window.masterApi.pickVoiceUpgrade());
upDrop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); upDrop.classList.add('drag'); });
upDrop.addEventListener('dragleave', () => upDrop.classList.remove('drag'));
upDrop.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation(); upDrop.classList.remove('drag');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/\.zip$/i.test(f.name)) return;
  window.masterApi.upgradeVoiceWithPath(f.path);
});
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/\.zip$/i.test(f.name)) return;
  openUpgradeModal(); // 窗口任意处拖入：先打开弹窗显示安装进度
  window.masterApi.upgradeVoiceWithPath(f.path);
});
// 退出桌宠：主进程走退出动画链路（播完由桌宠渲染层发 quit 真正退出）
document.getElementById('btnQuit').addEventListener('click', () => window.masterApi.quit());

window.masterApi.onActive((name) => setActive(name));

// 默认高亮对话模块（主进程 openModule 会再推一次，这里兜底）
setActive('chat');
refreshMaxBtn();
window.NECO_I18N.init();
