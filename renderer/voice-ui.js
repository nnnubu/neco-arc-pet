/* 渲染进程 - 语音输入条模块
 * 职责：输入条显示/收起、发送文本、接收音频播放与状态反馈
 * 入口：右键菜单「说句话…」（Controls 调 window.VoiceUI.open()）
 */
window.VoiceUI = (() => {
  let el = null;
  let input = null;
  let sendBtn = null;
  let closeBtn = null;
  let status = null;
  let audio = null;

  function init() {
    el = document.getElementById('speakBar');
    input = document.getElementById('speakInput');
    sendBtn = document.getElementById('speakSend');
    closeBtn = document.getElementById('speakClose');
    status = document.getElementById('speakStatus');
    audio = document.getElementById('petAudio');

    sendBtn.addEventListener('click', () => {
      // 清除孤立代理项（输入法/粘贴可能产生），防止传给 Python 时编码崩溃
      const t = input.value.replace(/[\uD800-\uDFFF]/g, '').trim();
      if (!t) return;
      window.pet.speakText(t);
    });
    closeBtn.addEventListener('click', hide);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 输入时不影响桌宠移动
      if (e.key === 'Enter') sendBtn.click();
      if (e.key === 'Escape') hide();
    });

    window.pet.onSpeakAudio((p) => {
      audio.src = 'file:///' + p.replace(/\\/g, '/');
      audio.play().catch((e) => {
        status.textContent = '播放失败: ' + (e.message || e);
      });
    });
    window.pet.onSpeakState((s) => {
      if (s.state === 'generating') {
        status.textContent = '喵…生成中（首次需等约 1 分钟）';
      } else if (s.state === 'done') {
        status.textContent = '';
        setTimeout(hide, 600);
      } else if (s.state === 'error') {
        status.textContent = '出错了: ' + (s.error || '未知');
      }
    });
  }

  function open() {
    el.style.display = 'flex';
    input.focus();
  }
  function hide() { el.style.display = 'none'; }

  return { init, open, hide };
})();
