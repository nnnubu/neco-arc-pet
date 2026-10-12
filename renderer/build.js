// 打包进度小窗：接收主进程 dev-build-progress 广播，展示阶段/百分比/失败日志
(function () {
  const bdTitle = document.getElementById('bdTitle');
  const bdStage = document.getElementById('bdStage');
  const bdFill = document.getElementById('bdFill');
  const bdPct = document.getElementById('bdPct');
  const bdLog = document.getElementById('bdLog');

  document.getElementById('bdClose').addEventListener('click', () => window.masterApi.closeBuildWin());

  window.masterApi.onDevBuild((s) => {
    if (!s || !s.t) return;
    if (s.kind) bdTitle.textContent = s.kind === 'voice' ? '生成语音扩展包' : '生成基础包';
    bdStage.textContent = s.t;
    bdStage.className = 'bd-stage' + (/完成|✓/.test(s.t) ? ' ok' : (/失败|✗/.test(s.t) ? ' err' : ''));
    if (typeof s.pct === 'number') {
      bdFill.classList.remove('indet');
      bdFill.style.width = Math.round(s.pct) + '%';
      bdPct.textContent = Math.round(s.pct) + '%';
    } else if (/开始|正在/.test(s.t)) {
      bdFill.classList.add('indet'); // 长阶段（构建/压缩）用不确定动画
      bdPct.textContent = '…';
    }
    if (s.err) {
      bdLog.hidden = false;
      bdLog.textContent = s.err;
    }
  });
})();
