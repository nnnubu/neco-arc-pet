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

// ── 语音升级：基础包（无语音扩展包）时隐藏 翻唱/语音合成 导航，标题栏 ⬆ 打开独立升级小窗 ──
const upgradeBtn = document.getElementById('btnUpgrade');

function applyVoiceUI(hasVoice) {
  // 有语音包 → 显示 翻唱/语音合成；无语音包（基础包）→ 隐藏并显示升级按钮
  // 注意：不能用 hidden 属性——.nav-item 有显式 display:flex 会覆盖 hidden，必须用 inline style
  document.querySelectorAll('.nav-item[data-voice]').forEach((b) => { b.style.display = hasVoice ? '' : 'none'; });
  upgradeBtn.hidden = !!hasVoice;
}
window.masterApi.getVoiceStatus().then((s) => applyVoiceUI(!!(s && s.hasVoice)));

// 升级入口：打开独立升级小窗（选框+进度条）。不用 HTML 弹窗——总面板右侧是原生
// WebContentsView，会盖住 HTML 层全屏弹窗，独立 BrowserWindow 才能正常展示。
upgradeBtn.addEventListener('click', () => window.masterApi.openUpgradeWin());
// 拖拽 .zip 到总面板窗口 → 打开升级小窗并开始安装（新版 Electron 无 File.path，须经 webUtils 取路径）
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/\.zip$/i.test(f.name)) return;
  const p = window.masterApi.getPathForFile ? window.masterApi.getPathForFile(f) : (f.path || '');
  if (!p) return;
  window.masterApi.openUpgradeWin();
  window.masterApi.upgradeVoiceWithPath(p);
});
// 退出桌宠：主进程走退出动画链路（播完由桌宠渲染层发 quit 真正退出）
document.getElementById('btnQuit').addEventListener('click', () => window.masterApi.quit());

window.masterApi.onActive((name) => setActive(name));

// 默认高亮对话模块（主进程 openModule 会再推一次，这里兜底）
setActive('chat');
refreshMaxBtn();
window.NECO_I18N.init();
