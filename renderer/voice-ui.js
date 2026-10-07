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
  let audio = null;

  // 角色帧底部有 ~48px 透明边距（alpha 实测），显示尺寸 = 边距 × SCALE(2) × petScale，
  // 所以输入框若固定贴窗口底，随缩放会"离桌宠越来越远/遮住脚"。改为跟随脚底：输入框顶始终距角色脚底 6px。
  const FOOT_MARGIN = 48; // standing 帧角色视觉脚底到帧底的距离（px @1x）
  const SPRITE_SCALE = 2; // sprite.js 的 SCALE
  const GAP = 6;          // 输入框顶到角色脚底的固定间隙
  const BAR_H = 36;       // 输入框整体高度（含 padding）

  function updatePosition(scale) {
    const footGap = 5 + FOOT_MARGIN * SPRITE_SCALE * scale; // 角色脚底到窗口底（精灵底部对齐 h-5）
    el.style.bottom = Math.max(2, footGap - GAP - BAR_H) + 'px';
  }

  function init() {
    el = document.getElementById('speakBar');
    input = document.getElementById('speakInput');
    sendBtn = document.getElementById('speakSend');
    retryBtn = document.getElementById('speakRetry');
    closeBtn = document.getElementById('speakClose');
    status = document.getElementById('speakStatus');
    audio = document.getElementById('petAudio');

    sendBtn.addEventListener('click', () => {
      // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
      const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
      if (!t) return;
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
    });
    window.pet.onSpeakState((s) => {
      if (s.state === 'generating') {
        status.style.display = 'block';
        status.textContent = '喵…生成中（首次需等约 1 分钟）';
      } else if (s.state === 'done') {
        status.style.display = 'none';
        status.textContent = '';
        setTimeout(hide, 600);
      } else if (s.state === 'error') {
        status.style.display = 'block';
        status.textContent = '出错了: ' + (s.error || '未知');
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
