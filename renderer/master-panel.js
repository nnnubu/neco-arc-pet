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

// ── 语音升级：基础包（无语音扩展包）时隐藏 翻唱/语音合成 导航，显示升级入口；已装语音包则隐藏入口 ──
const upgradeBtn = document.getElementById('btnUpgrade');
const upgradeMsg = document.getElementById('upgradeMsg');
function applyVoiceUI(hasVoice) {
  document.querySelectorAll('.nav-item[data-voice]').forEach((b) => { b.hidden = !!hasVoice; });
  upgradeBtn.hidden = !!hasVoice;
  upgradeMsg.hidden = true;
}
function upgradeMsgShow(text) {
  upgradeMsg.textContent = text;
  upgradeMsg.hidden = false;
}
window.masterApi.getVoiceStatus().then((s) => applyVoiceUI(!!(s && s.hasVoice)));
upgradeBtn.addEventListener('click', () => window.masterApi.pickVoiceUpgrade());
window.masterApi.onVoiceUpgrade((s) => {
  if (!s) return;
  if (s.state === 'unpacking') {
    upgradeBtn.disabled = true;
    upgradeMsgShow(t('upgrading'));
  } else if (s.state === 'done') {
    upgradeMsgShow(t('upgradeDone'));
  } else if (s.state === 'error') {
    upgradeBtn.disabled = false;
    const why = s.error === 'invalid' ? t('upgradeInvalid') : (s.error === 'already' ? t('upgradeAlready') : String(s.error || ''));
    upgradeMsgShow(t('upgradeFail') + why);
  }
});
// 拖拽 .zip 到总面板窗口 → 直接安装（与点击选择等效）
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/\.zip$/i.test(f.name)) return;
  window.masterApi.upgradeVoiceWithPath(f.path);
});
// 退出桌宠：主进程走退出动画链路（播完由桌宠渲染层发 quit 真正退出）
document.getElementById('btnQuit').addEventListener('click', () => window.masterApi.quit());

window.masterApi.onActive((name) => setActive(name));

// 默认高亮对话模块（主进程 openModule 会再推一次，这里兜底）
setActive('chat');
refreshMaxBtn();
window.NECO_I18N.init();
