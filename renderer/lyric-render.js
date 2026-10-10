// 桌面歌词窗口渲染：接收歌词数组，当前句高亮 + 卡拉OK式颜色渐变跟随播放进度
// 渐变：句切换淡出/淡入；句内由渲染层每帧 rAF 发来的 lyric-progress 更新 --p（已唱/未唱分界）
(function () {
  const $ = (s) => document.querySelector(s);
  let lyrics = [];
  let curIdx = -1;
  let curEl = null;

  window.lyricApi.onData((d) => {
    lyrics = (d && d.lyrics) || [];
    const title = (d && d.title) || '';
    $('#title').textContent = title;
    curIdx = -1;
    render(-1);
  });
  window.lyricApi.onIdx((i) => {
    if (i !== curIdx) {
      curIdx = i;
      render(i);
    }
  });
  // 句内进度：{index, t} → 计算已唱比例 → 更新当前句 --p（渐变分界跟随播放进度）
  window.lyricApi.onProgress((p) => {
    if (!p || curIdx !== p.index) return;
    const cur = lyrics[curIdx];
    if (!cur) return;
    const next = lyrics[curIdx + 1];
    const span = Math.max(0.5, (next ? next.time : cur.time + 4) - cur.time);
    const ratio = Math.max(0, Math.min(1, (p.t - cur.time) / span));
    if (curEl) curEl.style.setProperty('--p', Math.round(ratio * 100) + '%');
  });

  // 右键阻止系统窗口菜单（JS 拖动替代 app-region:drag 后，页面 contextmenu 可正常拦截）
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 鼠标滚轮缩放歌词（与桌宠滚轮缩放一致）：向上放大 / 向下缩小
  document.addEventListener('wheel', (e) => {
    e.preventDefault();
    window.lyricApi.resize(e.deltaY);
  }, { passive: false });

  // 主进程缩放通知：整体 zoom 跟随（内容随窗口等比放大缩小）
  window.lyricApi.onScale((s) => {
    document.documentElement.style.zoom = String(s);
  });

  // JS 拖动歌词窗口（替代 -webkit-app-region:drag：drag 区域会吞右键/滚轮）
  let dragging = false;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    window.lyricApi.dragStart({ sx: e.screenX, sy: e.screenY });
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    window.lyricApi.dragMove({ sx: e.screenX, sy: e.screenY });
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    window.lyricApi.dragEnd();
  });

  // 渐变切换：值相同不重绘；否则淡出 → 下一帧换文本淡入
  function fadeSwap(elm, text) {
    if (elm.dataset.v === text) return;
    elm.dataset.v = text;
    elm.style.opacity = '0';
    elm.style.transform = 'translateY(3px)';
    requestAnimationFrame(() => {
      elm.textContent = text;
      elm.style.opacity = '1';
      elm.style.transform = 'translateY(0)';
    });
  }

  function render(i) {
    const prev = $('#prev'), cur = $('#cur'), next = $('#next');
    curEl = cur;
    cur.style.setProperty('--p', '0%'); // 新句从 0 开始渐变
    if (!lyrics.length) {
      fadeSwap(cur, '♪');
      fadeSwap(prev, '');
      fadeSwap(next, '');
      return;
    }
    const p = i >= 0 && i < lyrics.length ? lyrics[i] : null;
    const pv = i >= 1 && i < lyrics.length ? lyrics[i - 1] : null;
    const nx = i >= 0 && i < lyrics.length - 1 ? lyrics[i + 1] : null;
    fadeSwap(cur, (p && p.text) || '♪');
    fadeSwap(prev, (pv && pv.text) || '');
    fadeSwap(next, (nx && nx.text) || '');
  }
})();
