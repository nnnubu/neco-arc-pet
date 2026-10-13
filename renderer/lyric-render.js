// 桌面歌词窗口渲染：接收歌词数组，当前句高亮 + 卡拉OK式颜色渐变跟随播放进度
// 渐变：句切换淡出/淡入；句内由渲染层每帧 rAF 发来的 lyric-progress 更新 --p（已唱/未唱分界）
(function () {
  const $ = (s) => document.querySelector(s);
  const t = (k) => window.NECO_I18N.t(k);
  let lyrics = [];
  let curIdx = -1;
  let curEl = null;

  // hex → 同色系深浅档（amt：负=加深，正=提亮；0=原色）
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }
  // hex → rgba 字符串（未唱部分用半透明暗色，卡拉OK未唱观感）
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  window.lyricApi.onData((d) => {
    lyrics = (d && d.lyrics) || [];
    const title = (d && d.title) || '';
    $('#title').textContent = title;
    // 歌词文本颜色（可配置，默认当前亮黄）：按主色推导卡拉OK三档（已唱亮/已唱主/未唱暗）
    const col = (d && /^#[0-9a-fA-F]{6}$/.test(String(d.color))) ? String(d.color) : '#ffd04d';
    const cur = $('#cur');
    cur.style.setProperty('--cur-bright', shade(col, 0.55));
    cur.style.setProperty('--cur-mid', col);
    cur.style.setProperty('--cur-dim', rgba(col, 0.38));
    curIdx = -1;
    render(-1);
  });
  window.lyricApi.onIdx((i) => {
    if (i !== curIdx) {
      curIdx = i;
      render(i);
    }
  });
  // 句内进度：{index, t, dur} → 计算已唱比例 → 更新当前句 --p（渐变分界跟随播放进度）+ 整首进度条
  let songDur = 0; // 当前歌曲总时长（进度条拖动计算用）
  window.lyricApi.onProgress((p) => {
    if (!p) return;
    if (p.dur > 0) songDur = p.dur;
    if (curIdx === p.index) {
      const cur = lyrics[curIdx];
      if (cur) {
        const next = lyrics[curIdx + 1];
        const span = Math.max(0.5, (next ? next.time : cur.time + 4) - cur.time);
        const ratio = Math.max(0, Math.min(1, (p.t - cur.time) / span));
        if (curEl) curEl.style.setProperty('--p', Math.round(ratio * 100) + '%');
      }
    }
    // 整首进度条（dur 为音频总时长秒）
    if (songDur > 0) {
      const r = Math.max(0, Math.min(1, p.t / songDur));
      document.getElementById('progressFill').style.width = Math.round(r * 100) + '%';
      document.getElementById('progressKnob').style.left = Math.round(r * 100) + '%';
      document.getElementById('progressTime').textContent = fmtTime(p.t) + ' / ' + fmtTime(songDur);
    }
  });
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    return (m < 10 ? '0' + m : m) + ':' + (s % 60 < 10 ? '0' + s % 60 : s % 60);
  }

  // ── 播放控制行：上一首/暂停/下一首、进度条拖动 seek ──
  const btnPrev = document.getElementById('lcPrev');
  const btnToggle = document.getElementById('lcToggle');
  const btnNext = document.getElementById('lcNext');
  btnPrev.addEventListener('click', (e) => { e.stopPropagation(); window.lyricApi.prev(); });
  btnToggle.addEventListener('click', (e) => { e.stopPropagation(); window.lyricApi.toggle(); });
  btnNext.addEventListener('click', (e) => { e.stopPropagation(); window.lyricApi.next(); });
  // 播放状态 → ⏸/▶ 切换（主进程 sing-state → lyric-state 广播）
  window.lyricApi.onState((s) => {
    btnToggle.textContent = s === 'playing' ? '⏸' : '▶';
  });

  // 进度条拖动 seek：mousedown 进入拖动 → mousemove 实时 seek（松手结束）
  let seeking = false;
  const progressEl = document.getElementById('progress');
  function seekFromX(clientX) {
    if (songDur <= 0) return;
    const rect = progressEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = ratio * songDur;
    document.getElementById('progressFill').style.width = Math.round(ratio * 100) + '%';
    document.getElementById('progressKnob').style.left = Math.round(ratio * 100) + '%';
    document.getElementById('progressTime').textContent = fmtTime(t) + ' / ' + fmtTime(songDur);
    window.lyricApi.seek(t);
  }
  progressEl.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    seeking = true;
    seekFromX(e.clientX);
  });
  document.addEventListener('mousemove', (e) => { if (seeking) seekFromX(e.clientX); });
  document.addEventListener('mouseup', () => { seeking = false; });

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
  // 只有按住歌词文本/标题（拖动把手）才拖动；透明/留白区鼠标穿透到下层（不挡下层操作）
  let dragging = false;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#lyricClose')) return; // 关闭按钮不触发拖动
    if (e.target.closest('#controls')) return;   // 进度条/控制按钮不触发拖动
    if (e.target.closest('#lyricLock')) return;  // 锁按钮不触发拖动
    if (!(e.target.closest('#prev') || e.target.closest('#cur') || e.target.closest('#next') || e.target.closest('#title'))) return; // 仅文本/标题区可拖动
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

  // 关闭歌词（隐藏窗口；播放不中断，下次播放自动重新显示）
  document.getElementById('lyricClose').addEventListener('click', (e) => {
    e.stopPropagation();
    window.lyricApi.hide();
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

  // ── 鼠标透传：双模式。
  // 解锁态（默认）：整窗拦截鼠标（不穿透）——控件显隐由 JS 驱动（mousemove 显示 / mouseleave 隐藏）、文本/标题区可拖动、可缩放。
  // 锁定态：除右上角锁按钮外整窗穿透（纯展示，完全不挡鼠标）；再点锁按钮解锁。
  // 穿透用 setIgnoreMouseEvents(true, {forward:true})：窗口仍能收到 mousemove 供锁按钮 hover 判定。
  // 控件显隐不用 CSS body:hover——透明窗口+透传切换时 Chromium 偶发收不到 mouseout 会致 :hover 粘住、控件常显。
  let lastIgnore = null;
  let locked = false;
  let lastMoveTarget = null;
  function setIgnore(ig) {
    if (lastIgnore === ig) return;
    lastIgnore = ig;
    window.lyricApi.setIgnore(ig);
  }
  function updateIgnore(target) {
    lastMoveTarget = target;
    // 锁按钮永远可点（解锁态点它进锁定；锁定态点它解锁）
    if (target.closest('#lyricLock')) { setIgnore(false); return; }
    if (locked) { setIgnore(true); return; } // 锁定态：除锁按钮外整窗穿透（不可拖不可缩放不可交互）
    setIgnore(false); // 解锁态：整窗拦截（不穿透）
  }
  // 控件显隐（关闭/控制行）：鼠标在窗口内移动即显示，离开窗口隐藏；锁定态由 CSS body.locked 强制隐藏兜底
  function setControlsVisible(v) {
    document.body.classList.toggle('show-ctrl', v);
  }
  function setLocked(v) {
    locked = v;
    document.body.classList.toggle('locked', v);
    if (v) setControlsVisible(false); // 锁定即隐藏控件（纯展示）
    // 锁图标：锁定=梁伸入锁体，解锁=梁悬空
    document.getElementById('lockSvg').innerHTML = v
      ? '<path d="M5 8V6a3 3 0 0 1 6 0V8"/><rect x="3" y="8" width="10" height="7" rx="1.6"/>'
      : '<path d="M5 8V6a3 3 0 0 1 6 0"/><rect x="3" y="8" width="10" height="7" rx="1.6"/>';
    // 状态切换后立刻按当前鼠标位置刷新穿透判定
    if (lastMoveTarget) updateIgnore(lastMoveTarget);
  }
  document.getElementById('lyricLock').addEventListener('click', (e) => {
    e.stopPropagation();
    setLocked(!locked);
  });
  // 初始默认解锁：整窗拦截（不穿透）；鼠标进入窗口显示控件，离开窗口隐藏
  setIgnore(false);
  document.addEventListener('mousemove', (e) => { updateIgnore(e.target); setControlsVisible(true); }, { passive: true });
  document.addEventListener('mouseleave', () => setControlsVisible(false));
  window.NECO_I18N.init();

  function render(i) {
    const prev = $('#prev'), cur = $('#cur'), next = $('#next');
    curEl = cur;
    cur.style.setProperty('--p', '0%'); // 新句从 0 开始渐变
    if (!lyrics.length) {
      // 无歌词：显示占位（本地无 .lrc 且联网也没搜到时）
      fadeSwap(cur, t('lyricNoLyric'));
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
