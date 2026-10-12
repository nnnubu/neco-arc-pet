// 桌面歌词窗口渲染：接收歌词数组，当前句高亮 + 卡拉OK式颜色渐变跟随播放进度
// 渐变：句切换淡出/淡入；句内由渲染层每帧 rAF 发来的 lyric-progress 更新 --p（已唱/未唱分界）
(function () {
  const $ = (s) => document.querySelector(s);
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
  let dragging = false;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#lyricClose')) return; // 关闭按钮不触发拖动
    if (e.target.closest('#controls')) return;   // 进度条/控制按钮不触发拖动
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

  // ── 鼠标透传（类桌宠）：歌词文字区穿透下层不挡鼠标；hover 到控件/标题/留白恢复拦截可交互。
  // 穿透用 setIgnoreMouse(true, {forward:true})：窗口仍能收到 mousemove 供 hover 判定。
  let lastIgnore = null;
  function setIgnore(ig) {
    if (lastIgnore === ig) return;
    lastIgnore = ig;
    window.lyricApi.setIgnore(ig);
  }
  function updateIgnore(target) {
    // 控件区（上一首/暂停/下一首/进度条/关闭）→ 拦截，可点击
    if (target.closest('#controls') || target.closest('#lyricClose')) { setIgnore(false); return; }
    // 歌词文字区（prev/cur/next）→ 穿透，不挡下层
    if (target.closest('#prev') || target.closest('#cur') || target.closest('#next')) { setIgnore(true); return; }
    // 其余（标题/留白）→ 拦截，可拖动窗口/滚轮缩放
    setIgnore(false);
  }
  // 初始默认穿透（歌词纯展示；需要操作时鼠标移到控件/留白自动恢复）
  setIgnore(true);
  document.addEventListener('mousemove', (e) => updateIgnore(e.target), { passive: true });

  function render(i) {
    const prev = $('#prev'), cur = $('#cur'), next = $('#next');
    curEl = cur;
    cur.style.setProperty('--p', '0%'); // 新句从 0 开始渐变
    if (!lyrics.length) {
      // 无歌词：显示占位（本地无 .lrc 且联网也没搜到时）
      fadeSwap(cur, '暂无歌词');
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
