/* 渲染进程 - 交互控制模块
 * 职责：鼠标拖拽、滚轮缩放、右键菜单、键盘移动、鼠标进入聚焦
 * 依赖：shared（keys / petScale / maxScale）、SpriteCore
 */
window.Controls = (() => {
  const KEY_MAP = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
  };
  const SCALE_STEP = 0.1; // 每格滚轮缩放步长
  const SCALE_MIN = 0.5;  // 最小缩放倍率
  const DRAG_THRESHOLD = 6; // 按下后位移超过该值判定为拖拽（桌宠），避免误触

  let shared = null;
  let sprite = null;
  let downAt = null;   // 按下时间戳（区分点击/拖拽）
  let downPos = null;  // 按下位置
  let dragging = false;

  function init(shared_, sprite_) {
    shared = shared_;
    sprite = sprite_;

    document.addEventListener('mousedown', (e) => {
      downAt = Date.now();
      downPos = { x: e.clientX, y: e.clientY };
      dragging = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!downAt) return;
      if (!dragging) {
        // 位移超过阈值才视为拖拽；点击（菜单/输入条）不触发
        if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > DRAG_THRESHOLD) {
          dragging = true;
          window.pet.dragStart();
        }
      } else {
        // 拖拽中持续跟随鼠标（主进程按鼠标位移移动窗口）
        window.pet.dragMove();
      }
    });
    document.addEventListener('mouseup', () => {
      if (dragging) window.pet.dragEnd();
      downAt = null;
      downPos = null;
      dragging = false;
    });

    // 滚轮缩放（petScale 由主进程校验并回传实际值）
    document.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cur = shared.petScale;
      const next = e.deltaY < 0
        ? Math.min(cur + SCALE_STEP, shared.maxScale || 3)
        : Math.max(SCALE_MIN, cur - SCALE_STEP);
      window.pet.setScale(next);
    }, { passive: false });

    // 右键菜单 → 主进程弹出原生菜单 → menu-action 回调
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.pet.showMenu();
    });
    window.pet.onMenuAction((name) => {
      if (name === 'SPEAK') { window.pet.openChat(); return; } // 打开独立对话窗口（不再用桌宠内输入条）
      if (name === 'RESET') { sprite.backToIdle(); return; }
      // 趴下 / 站起切换：常驻趴（act_23）循环播放中 → 回待机站立；否则 → 播放 act_23 常驻趴
      if (name === 'TOGGLE_LIE') {
        if (sprite.currentName === 'act_23' && sprite.state === 'oneshot') { sprite.backToIdle(); return; }
        sprite.playOneshot('act_23');
        return;
      }
      // 转向动画内容自带方向，走专用播放（不按当前朝向翻转，避免方向反掉）
      if (name === 'turn_left' || name === 'turn_right') { sprite.playTurn(name); return; }
      sprite.playOneshot(name);
    });

    // 键盘移动
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') { shared.keys.shift = true; return; }
      const k = KEY_MAP[e.key];
      if (!k) return;
      e.preventDefault();
      shared.keys[k] = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') { shared.keys.shift = false; return; }
      const k = KEY_MAP[e.key];
      if (!k) return;
      shared.keys[k] = false;
    });
    window.addEventListener('mouseenter', () => window.pet.focusWindow());
  }

  return { init };
})();
