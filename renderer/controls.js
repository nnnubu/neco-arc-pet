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

  // 鼠标穿透状态：鼠标不在角色像素上时窗口忽略鼠标事件（点击穿透到下层窗口/桌面），
  // 不再被透明窗口矩形整块拦截（点桌宠附近不会被误判成拖拽）
  let mouseIgnored = false;

  // 判断鼠标（窗口内坐标）是否在角色像素上并切换穿透。
  // 数据源是主进程 40ms 轮询的 mouse-pos（全局光标，不受窗口忽略鼠标影响）——
  // 即使穿透开启，鼠标移回角色时仍能及时恢复接收，点击/拖拽/菜单照常可用
  function updateMousePass(p) {
    if (dragging) {
      // 拖拽中必须保持接收鼠标：穿透会让 mouseup 丢失（窗口收不到鼠标事件），拖拽无法结束
      if (mouseIgnored) { mouseIgnored = false; window.pet.setIgnoreMouse(false); }
      return;
    }
    if (!p) return;
    const hit = sprite.hitTest(p.mx - p.wx, p.my - p.wy);
    const wantIgnore = !hit;
    if (wantIgnore !== mouseIgnored) {
      mouseIgnored = wantIgnore;
      window.pet.setIgnoreMouse(wantIgnore);
    }
  }

  function init(shared_, sprite_) {
    shared = shared_;
    sprite = sprite_;
    window.pet.onMousePos(updateMousePass); // 鼠标穿透：透明区域不拦截鼠标（index.js 另有写入 shared.lastMouse 供其他模块用）

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

    // 右键点击桌宠 → 打开总面板（原右键菜单栏已移除，总面板承载全部功能入口）
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.pet.openMaster();
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
    // 失焦时清空全部按键状态：窗口失焦瞬间 keyup 可能丢失（按键在别处松开/焦点切换），
    // 残留方向键会导致移动方向叠加——比如 down 残留后按 A 就变成"向左下移动"
    window.addEventListener('blur', () => {
      for (const k of Object.values(KEY_MAP)) shared.keys[k] = false;
      shared.keys.shift = false;
    });
    window.addEventListener('mouseenter', () => window.pet.focusWindow());
  }

  return { init };
})();
