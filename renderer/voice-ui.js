/* 渲染进程 - 语音输入条模块
 * 职责：输入条显示/收起、发送文本、接收音频播放与状态反馈、位置跟随桌宠脚底
 * 入口：右键菜单「说句话…」（Controls 调 window.VoiceUI.open()）
 */
window.VoiceUI = (() => {
  let el = null;
  let input = null;
  let sendBtn = null;
  let retryBtn = null;
  let closeBtn = null;
  let status = null;
  let aiText = null;
  let audio = null;

  // 角色帧底部有 ~48px 透明边距（alpha 实测），显示尺寸 = 边距 × SCALE(2) × petScale，
  // 所以输入框若固定贴窗口底，随缩放会"离桌宠越来越远/遮住脚"。改为跟随脚底：输入框顶始终距角色脚底 6px。
  const FOOT_MARGIN = 48; // standing 帧角色视觉脚底到帧底的距离（px @1x）
  const SPRITE_SCALE = 2; // sprite.js 的 SCALE
  const GAP = 8;          // 输入框顶到角色脚底的固定间隙（加大：不再贴住遮住脚底）
  const BAR_H = 36;       // 输入框整体高度（含 padding）

  // 流式状态：AI 回复全文、是否正在跟随语音
  let replyText = '';
  let syncMode = false; // true=播放阶段逐字跟随语音；false=AI 生成阶段（仅累积文本）
  let singHideTimer = null; // 翻唱结果/错误文本的自动关闭定时器

  function updatePosition(scale) {
    const footGap = 5 + FOOT_MARGIN * SPRITE_SCALE * scale; // 角色脚底到窗口底（精灵底部对齐 h-5）
    el.style.bottom = Math.max(2, footGap - GAP - BAR_H) + 'px';
  }

  // 对话文本定位：透明文字放桌宠左右侧（随朝向），不遮住桌宠本身
  // 左右各留 62%~98%（朝右）或 2%~38%（朝左）的对称区域，文本在容器内换行不溢出裁剪
  function positionAiText() {
    if (!aiText) return;
    const W = window.innerWidth, H = window.innerHeight;
    const facing = (window.SpriteCore && window.SpriteCore.facing) || 1;
    const fs = Math.max(12, Math.round(13 * W / 220)); // 字号随窗口缩放（初始 220px 宽 = 13px）
    aiText.style.fontSize = fs + 'px';
    aiText.style.maxWidth = Math.round(W * 0.36) + 'px';
    aiText.style.top = Math.round(H * 0.16) + 'px'; // 角色头部高度附近
    aiText.style.right = 'auto';
    aiText.style.transform = 'none';
    aiText.style.textAlign = 'left';
    if (facing >= 0) {
      aiText.style.left = Math.round(W * 0.68) + 'px'; // 朝右：文本靠右侧（更靠边，避免遮角色）
      aiText.style.maxWidth = Math.round(W * 0.28) + 'px';
    } else {
      aiText.style.left = '2%'; // 朝左：文本靠左侧（左对齐，不溢出）
      aiText.style.maxWidth = Math.round(W * 0.28) + 'px';
    }
  }

  // 显示文本：复用持久 span（只改 textContent），避免每帧重建 DOM 导致卡顿
  let textSpan = null;
  function showAiText(text) {
    if (!aiText) return;
    if (!textSpan) { textSpan = document.createElement('span'); aiText.appendChild(textSpan); }
    textSpan.textContent = text;
    aiText.style.display = 'block';
  }

  function init() {
    el = document.getElementById('speakBar');
    input = document.getElementById('speakInput');
    sendBtn = document.getElementById('speakSend');
    retryBtn = document.getElementById('speakRetry');
    closeBtn = document.getElementById('speakClose');
    status = document.getElementById('speakStatus');
    aiText = document.getElementById('aiText');
    audio = document.getElementById('petAudio');

    sendBtn.addEventListener('click', () => {
      // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
      const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
      if (!t) return;
      // 唱歌命令：输入「唱 <歌曲路径>」→ 翻唱（分离→变声→混音），不走 AI 问答
      const m = t.match(/^唱(歌)?\s+(\S.*)$/);
      if (m) {
        const p = m[2].replace(/^["']|["']$/g, '').trim();
        window.pet.singSong(p);
        return;
      }
      window.pet.speakText(t);
    });
    retryBtn.addEventListener('click', () => {
      // 强制重新合成（绕过缓存）：偶发 edge-tts 内容错误时可重新生成并覆盖旧缓存
      const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
      if (!t) return;
      window.pet.speakText(t, true);
    });
    closeBtn.addEventListener('click', hide);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 输入时不影响桌宠移动
      if (e.key === 'Enter') sendBtn.click();
      if (e.key === 'Escape') hide();
    });

    window.pet.onSpeakAudio((p) => {
      // file:// URL 逐段编码：路径含中文/空格时直接拼接可能解码失败或播错
      const url = 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
      audio.src = url;
      audio.play().catch((e) => {
        status.style.display = 'block';
        status.textContent = '播放失败: ' + (e.message || e);
      });
      // 播放阶段才开始渲染文本：逐字跟随语音节奏（语音说哪，字体显示到哪）
      // 优化：定位只做一次（移出循环）；逐帧 rAF 轮询但仅字数变化时才写 DOM（减少重排）
      if (aiText && replyText) {
        syncMode = true;
        aiText.style.display = 'none';
        const total = replyText.length;
        positionAiText(); // 位置固定一次（播放中朝向/窗口不变）
        let raf = null;
        let lastN = -1;
        audio.onloadedmetadata = () => {
          const dur = audio.duration || 1;
          const tick = () => {
            if (!syncMode) return;
            const n = Math.min(total, Math.round((audio.currentTime / dur) * total));
            if (n !== lastN) {
              // 确保 span 存在（未经过 showAiText 时先创建，否则 null.textContent 会中断循环）
              if (!textSpan) { textSpan = document.createElement('span'); aiText.appendChild(textSpan); }
              textSpan.textContent = replyText.slice(0, n);
              lastN = n;
              aiText.style.display = 'block'; // 恢复显示（播放开始时被隐藏，首次逐字即显示）
            }
            if (n < total) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        };
        audio.onended = () => {
          if (!syncMode) return;
          syncMode = false;
          showAiText(replyText); // 全文显示
          // 播放完毕再停留 2 秒后关闭文本（等用户新问题再渲染新回答）
          setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 2000);
        };
      }
    });
    window.pet.onSpeakState((s) => {
      if (s.state === 'ai') {
        // AI 思考开始：清空上一次回复，重置流式状态
        syncMode = false;
        replyText = '';
        if (aiText) aiText.style.display = 'none';
        status.style.display = 'block';
        status.textContent = '喵…思考中';
      } else if (s.state === 'generating') {
        status.style.display = 'block';
        status.textContent = '生成语音中…';
      } else if (s.state === 'done') {
        status.style.display = 'none';
        status.textContent = '';
        // 输入条隐藏（文本关闭由 audio.onended 的 2 秒停留管理）
        setTimeout(hide, 600);
      } else if (s.state === 'error') {
        status.style.display = 'block';
        status.textContent = '出错了: ' + (s.error || '未知');
      }
    });
    // AI 流式 token：只累积文本，不在生成阶段显示（语音播放时才渲染）
    window.pet.onAiToken((r) => {
      if (syncMode) return;
      replyText += r.text || '';
    });
    // AI 回复完成：保存全文，等待语音播放时再渲染
    window.pet.onAiReply((r) => {
      replyText = r.text || '';
    });

    // ── 唱歌（翻唱）反馈：进度 / 完成 / 错误 ──
    const STAGE_TEXT = {
      separate: '正在分离人声…',
      convert: '正在变声成喵声…',
      mix: '正在混音…',
      done: '翻唱完成！',
    };
    window.pet.onSingProgress((s) => {
      status.style.display = 'block';
      status.textContent = STAGE_TEXT[s.stage] || '翻唱中…';
    });
    window.pet.onSingDone((r) => {
      status.style.display = 'block';
      status.textContent = '翻唱完成！';
      replyText = '';
      syncMode = false;
      if (aiText) {
        const full = String(r.full || '').replace(/\\/g, '/');
        const vocal = String(r.vocal || '').replace(/\\/g, '/');
        showAiText('唱好啦喵！\n完整版：' + full + '\n人声轨：' + vocal);
        positionAiText();
        aiText.style.display = 'block';
        clearTimeout(singHideTimer);
        singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 15000);
      }
      setTimeout(hide, 1500);
    });
    window.pet.onSingError((e) => {
      const msg = String(e || '未知');
      status.style.display = 'block';
      status.textContent = '翻唱失败: ' + msg;
      if (aiText) {
        showAiText('翻唱失败喵：' + msg);
        positionAiText();
        aiText.style.display = 'block';
        clearTimeout(singHideTimer);
        singHideTimer = setTimeout(() => { if (aiText) aiText.style.display = 'none'; }, 8000);
      }
    });
  }

  function open() {
    el.style.display = 'block';
    input.focus();
  }
  function hide() { el.style.display = 'none'; }

  return { init, open, hide, updatePosition };
})();
