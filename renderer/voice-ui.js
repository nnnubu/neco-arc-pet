/* 渲染进程 - 桌宠语音/翻唱播放模块（对话交互 UI 已移至独立对话窗口 main/chat.js + renderer/chat.*）
 * 职责：语音播放 + AI 回复透明文字逐字跟随 + 翻唱播放/暂停 + 桌面歌词窗口数据与卡拉OK进度驱动
 * 消息与状态显示：由主进程 broadcast 到对话窗口（chat.js）负责
 */
window.VoiceUI = (() => {
  let aiText = null;      // 透明文字（跟随桌宠左右侧，不遮桌宠）
  let audio = null;       // 语音播放
  let singAudio = null;   // 翻唱播放
  let lastLyricIdx = -1;  // 歌词窗口当前句索引（避免重复 send）
  let currentSingLyrics = null; // 当前翻唱歌词（播放不等歌词：搜索完成异步补发）

  // 流式状态：AI 回复全文、是否正在跟随语音
  let replyText = '';
  let syncMode = false;

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

  // 对话文本定位：透明文字放桌宠左右侧（随朝向），不遮住桌宠本身
  function positionAiText() {
    if (!aiText) return;
    const W = window.innerWidth, H = window.innerHeight;
    const facing = (window.SpriteCore && window.SpriteCore.facing) || 1;
    // 字号随桌宠缩放但有上限：桌宠放大后不至于一行只放 3~4 个字
    const fs = Math.max(12, Math.min(18, Math.round(13 * W / 220)));
    aiText.style.fontSize = fs + 'px';
    aiText.style.top = Math.round(H * 0.1) + 'px';
    aiText.style.right = 'auto';
    aiText.style.transform = 'none';
    aiText.style.textAlign = 'left';
    // 离桌宠更远：右侧推到窗口最右缘（0.68W 起点 + 0.30W 宽，一行承载更多字）
    if (facing >= 0) {
      aiText.style.left = Math.round(W * 0.68) + 'px';
      aiText.style.maxWidth = Math.round(W * 0.30) + 'px';
    } else {
      aiText.style.left = '0';
      aiText.style.maxWidth = Math.round(W * 0.30) + 'px';
    }
  }

  // 段落式渲染：固定行块（打字时只填内容不重建 DOM → 不闪烁）
  // 按断句聚合成长行（每行目标 ~14 字，行长承载更多），偶行缩进形成错落段落感
  let paraLines = []; // [{ el, text }]
  function setupParagraphs(fullText) {
    if (!aiText) return;
    aiText.textContent = '';
    const segs = String(fullText).split(/(?<=[。！？；…])/).map((s) => s.trim()).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const s of segs) {
      if (cur && cur.length + s.length > 14) { lines.push(cur); cur = s; }
      else cur += s;
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push(String(fullText));
    paraLines = lines.map((txt, i) => {
      const d = document.createElement('div');
      d.style.marginBottom = '0.45em';
      if (i % 2 === 1) d.style.marginLeft = '1.2em'; // 偶行缩进 → 错落段落感
      aiText.appendChild(d);
      return { el: d, text: txt };
    });
  }
  function paintParagraphs(n) {
    if (!aiText) return;
    let remain = n;
    for (const ln of paraLines) {
      if (remain <= 0) { ln.el.textContent = ''; continue; }
      const take = Math.min(remain, ln.text.length);
      ln.el.textContent = ln.text.slice(0, take);
      remain -= take;
    }
  }

  // 显示文本：预分块 + 全量填充（打字/整句都走这里）
  function showAiText(text) {
    if (!aiText) return;
    setupParagraphs(text);
    paintParagraphs(String(text).length);
    aiText.style.display = 'block';
  }

  let singHideTimer = null;

  function init() {
    aiText = document.getElementById('aiText');
    audio = document.getElementById('petAudio');
    singAudio = document.getElementById('singAudio');

    // 语音播放 + 透明文字逐字跟随语音节奏（播放阶段才开始渲染文本）
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
        // 播放失败：透明文字提示
        if (aiText) {
          showAiText('播放失败喵：' + (e.message || e));
          positionAiText();
          aiText.style.display = 'block';
          clearTimeout(singHideTimer);
          singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 5000);
        }
      });
      if (aiText && replyText) {
        syncMode = true;
        aiText.style.display = 'none';
        const total = replyText.length;
        positionAiText();
        let raf = null;
        let lastN = -1;
        audio.onloadedmetadata = () => {
          const dur = audio.duration || 1;
          const tick = () => {
            if (!syncMode) return;
            const n = Math.min(total, Math.round((audio.currentTime / dur) * total));
            if (n !== lastN) {
              if (!paraLines.length) setupParagraphs(replyText); // 首次：固定行块（不重建，避免闪烁）
              paintParagraphs(n);
              lastN = n;
              aiText.style.display = 'block';
            }
            if (n < total) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        };
        audio.onended = () => {
          if (!syncMode) return;
          syncMode = false;
          showAiText(replyText);
          setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 2000);
        };
      }
    });
    // AI 流式 token：累积文本（对话窗显示气泡；这里为语音逐字准备全文）
    window.pet.onAiToken((r) => {
      if (syncMode) return;
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
          if (aiText) {
            showAiText('翻唱播放失败喵（文件无法解码）');
            positionAiText();
            aiText.style.display = 'block';
            clearTimeout(singHideTimer);
            singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 5000);
          }
        };
        const pp = singAudio.play();
        if (pp && pp.catch) pp.catch((e) => {
          stopLyricRaf();
          if (aiText) {
            showAiText('翻唱播放失败喵：' + (e.message || e));
            positionAiText();
            aiText.style.display = 'block';
            clearTimeout(singHideTimer);
            singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 5000);
          }
        });
      } catch (e) {
        stopLyricRaf();
        if (aiText) {
          showAiText('翻唱播放异常喵：' + (e.message || e));
          positionAiText();
          aiText.style.display = 'block';
          clearTimeout(singHideTimer);
          singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 5000);
        }
      }
    }
    // 播放/暂停：对话窗口按钮 / 翻唱面板按钮 → 主进程 → 这里
    function toggleSing() {
      if (!singAudio || !singAudio.src) return;
      if (singAudio.paused) {
        singAudio.play().catch((e) => {
          if (aiText) {
            showAiText('播放失败喵：' + (e.message || e));
            positionAiText();
            aiText.style.display = 'block';
            clearTimeout(singHideTimer);
            singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 5000);
          }
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
    // 翻唱失败：透明文字提示（详细消息显示在对话窗）
    window.pet.onSingError((e) => {
      if (aiText) {
        showAiText('翻唱失败喵：' + String(e || '未知'));
        positionAiText();
        aiText.style.display = 'block';
        clearTimeout(singHideTimer);
        singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 6000);
      }
    });
  }

  return { init };
})();
