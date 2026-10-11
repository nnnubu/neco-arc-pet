/* 渲染进程 - 桌宠语音/翻唱播放模块（对话交互 UI 已移至独立对话窗口 main/chat.js + renderer/chat.*）
 * 职责：语音播放 + AI 回复整段文本气泡（缩放淡入/淡出动效）+ 翻唱播放/暂停 + 桌面歌词窗口数据与卡拉OK进度驱动
 * 消息与状态显示：由主进程 broadcast 到对话窗口（chat.js）负责
 */
window.VoiceUI = (() => {
  let audio = null;       // 语音播放
  let singAudio = null;   // 翻唱播放
  let lastLyricIdx = -1;  // 歌词窗口当前句索引（避免重复 send）
  let currentSingLyrics = null; // 当前翻唱歌词（播放不等歌词：搜索完成异步补发）

  // AI 回复全文（语音播放时整段显示到气泡，不做逐字打字）
  let replyText = '';

  // ── 随机发声素材播放（独立 audio，短音效；只在空闲时被触发，不打断翻唱/语音）──
  let clipAudio = null;
  function playClip(p) {
    if (!clipAudio) clipAudio = new Audio();
    clipAudio.src = 'file:///' + String(p || '').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
    clipAudio.volume = 0.9;
    clipAudio.play().catch(() => {});
  }

  // ── 独立气泡窗口：透明置顶穿透，显示在桌宠左/右侧（按朝向），完全不遮 arc ──
  function bubbleShow(text) {
    try {
      const facing = (window.SpriteCore && window.SpriteCore.facing) || 1;
      window.pet.bubbleShow(String(text || ''), facing);
    } catch (e) {}
  }
  function bubbleHide() {
    try { window.pet.bubbleHide(); } catch (e) {}
  }
  // 提示文字：显示 N 秒后自动隐藏（统一入口）
  let bubbleTimer = null;
  function bubbleTip(text, ms) {
    bubbleShow(text);
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(bubbleHide, ms || 4000);
  }

  // 歌词卡拉OK进度循环（rAF 驱动，60fps 平滑；被遮挡也不停——主进程 backgroundThrottling:false）
  let lyricRaf = null;
  function stopLyricRaf() {
    if (lyricRaf) { cancelAnimationFrame(lyricRaf); lyricRaf = null; }
  }
  function startLyricRaf() {
    stopLyricRaf();
    const loop = () => {
      lyricRaf = requestAnimationFrame(loop);
      try {
        const ls = currentSingLyrics;
        if (!ls || !ls.length || !singAudio || singAudio.paused) return;
        const t = singAudio.currentTime;
        let idx = 0;
        for (let i = 0; i < ls.length; i++) {
          if (ls[i].time <= t) idx = i; else break;
        }
        if (idx !== lastLyricIdx) {
          lastLyricIdx = idx;
          window.pet.lyricUpdate(idx);
        }
        // 每帧句内进度 → 歌词窗口卡拉OK颜色渐变（已唱/未唱分界跟随进度）+ 整首进度条
        window.pet.lyricProgress(idx, t, singAudio.duration || 0);
      } catch (e) {}
    };
    lyricRaf = requestAnimationFrame(loop);
  }

  function init() {
    audio = document.getElementById('petAudio');
    singAudio = document.getElementById('singAudio');
    window.pet.onPlayClip((r) => { if (r && r.path) playClip(r.path); });

    // 翻唱音量：应用持久化音量 + 面板滑块实时调节（localStorage 记忆）
    try {
      const saved = parseFloat(localStorage.getItem('singVolume') || '0.8');
      singAudio.volume = Math.max(0, Math.min(1, saved || 0.8));
    } catch (e) { singAudio.volume = 0.8; }
    window.pet.onSingVolume((v) => {
      singAudio.volume = Math.max(0, Math.min(1, Number(v) || 0.8));
      try { localStorage.setItem('singVolume', String(singAudio.volume)); } catch (e) {}
    });

    // 语音播放 + 整段文本气泡（不做逐字打字：文本整体缩放淡入出现，播放结束缩放淡出消失，流畅不卡）
    window.pet.onSpeakAudio((p) => {
      // 语音说话优先：打断翻唱播放并隐藏歌词窗口（互斥，避免两路声音重叠）
      if (singAudio && !singAudio.paused) {
        singAudio.pause();
        singAudio.currentTime = 0;
        stopLyricRaf();
        window.pet.lyricHide();
        lastLyricIdx = -1;
        currentSingLyrics = null;
      }
      // file:// URL 逐段编码：路径含中文/空格时直接拼接可能解码失败或播错
      const url = 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
      audio.src = url;
      audio.play().catch((e) => {
        // 播放失败：气泡提示
        bubbleTip('播放失败喵：' + (e.message || e), 5000);
      });
      // 完整文本一次性显示（气泡窗口 pop-in 放大淡入），不再逐字跟随
      if (replyText) {
        bubbleShow(replyText);
        audio.onended = () => {
          // 播完停留片刻，再缩放淡出隐藏
          setTimeout(bubbleHide, 2000);
        };
      }
    });
    // AI 流式 token：累积文本（对话窗显示气泡；这里为语音播放时整段气泡准备全文）
    window.pet.onAiToken((r) => {
      replyText += (r && r.text) || '';
    });
    // AI 回复完成：保存全文
    window.pet.onAiReply((r) => {
      replyText = (r && r.text) || '';
    });

    // ── 翻唱（唱歌）──
    // 播放翻唱完整版 + 桌面歌词同步（菜单历史/翻唱面板/翻唱完成自动播放都走这里；歌词可稍后补发）
    function playSing(full, name) {
      try {
        if (!full) return;
        // 上报当前播放歌名（歌词窗"下一首"定位用）
        try { window.pet.singNow(name || ''); } catch (e) {}
        // 暂停语音（互斥：翻唱播放时不让语音插话）
        if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; }
        // 重置播放器状态：清掉旧事件处理器（防上一首的 onended/onerror 干扰本次）
        singAudio.onplay = null;
        singAudio.onpause = null;
        singAudio.onended = null;
        singAudio.onerror = null;
        singAudio.ontimeupdate = null;
        singAudio.pause();
        singAudio.currentTime = 0;
        singAudio.preload = 'auto';
        const url = 'file:///' + String(full).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
        singAudio.src = url;
        if (currentSingLyrics && currentSingLyrics.length) {
          window.pet.lyricShow(currentSingLyrics, name || '');
        } else {
          window.pet.lyricHide();
        }
        lastLyricIdx = -1;
        // 句切换与卡拉OK进度由 rAF 循环驱动（不再依赖 timeupdate，帧率更高更平滑）
        startLyricRaf();
        singAudio.onended = () => {
          stopLyricRaf();
          window.pet.lyricHide();
          lastLyricIdx = -1;
          currentSingLyrics = null;
          try { window.pet.singState('ended'); } catch (e) {}
        };
        singAudio.onplay = () => { try { window.pet.singState('playing'); } catch (e) {} };
        singAudio.onpause = () => { try { window.pet.singState('paused'); } catch (e) {} };
        singAudio.onerror = () => {
          stopLyricRaf();
          bubbleTip('翻唱播放失败喵（文件无法解码）', 5000);
        };
        const pp = singAudio.play();
        if (pp && pp.catch) pp.catch((e) => {
          stopLyricRaf();
          bubbleTip('翻唱播放失败喵：' + (e.message || e), 5000);
        });
      } catch (e) {
        stopLyricRaf();
        bubbleTip('翻唱播放异常喵：' + (e.message || e), 5000);
      }
    }
    // 播放/暂停：对话窗口按钮 / 翻唱面板按钮 → 主进程 → 这里
    function toggleSing() {
      if (!singAudio || !singAudio.src) return;
      if (singAudio.paused) {
        singAudio.play().catch((e) => {
          bubbleTip('播放失败喵：' + (e.message || e), 5000);
        });
        startLyricRaf();
      } else {
        singAudio.pause();
        stopLyricRaf();
      }
    }
    window.pet.onSingToggle(() => toggleSing());

    // 歌词窗进度条拖动 seek：直接设置播放位置（暂停中只改位置，恢复播放从新位置开始）
    window.pet.onSingSeek((t) => {
      if (!singAudio || !singAudio.src) return;
      try {
        const dur = singAudio.duration || 0;
        singAudio.currentTime = Math.max(0, Math.min(t, dur || t));
      } catch (e) {}
    });

    // 对话窗口打开时同步当前播放状态（按钮 ▶/⏸ 与翻唱面板一致）
    window.pet.onSingAskState(() => {
      try {
        if (singAudio && singAudio.src) {
          window.pet.singState(singAudio.paused ? 'paused' : 'playing');
        } else {
          window.pet.singState('ended');
        }
      } catch (e) {}
    });

    window.pet.onSingDone((r) => {
      // 翻唱完成 → 自动播放完整版（播放不等歌词，歌词搜索完成后由 onSingLyric 补发）
      currentSingLyrics = null;
      if (r && r.full) playSing(r.full, r.name || '');
    });
    // 菜单「翻唱历史」/ 翻唱面板历史：播放某首歌（歌词搜到后异步补发）
    window.pet.onSingPlay((r) => {
      if (!r || !r.full) return;
      currentSingLyrics = null;
      playSing(r.full, r.name || '');
    });
    // 歌词异步补发：播放开始后搜到歌词 → 显示桌面歌词窗口（时间轴与翻唱一致，同步立即生效）
    window.pet.onSingLyric((r) => {
      if (!r || !r.lyrics || !r.lyrics.length) return;
      currentSingLyrics = r.lyrics;
      if (singAudio && !singAudio.paused) window.pet.lyricShow(r.lyrics, r.title || '');
    });
    // 翻唱失败：气泡提示（详细消息显示在对话窗）
    window.pet.onSingError((e) => {
      bubbleTip('翻唱失败喵：' + String(e || '未知'), 6000);
    });
  }

  return { init };
})();
