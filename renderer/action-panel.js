// 猫姬桌宠 - 动作面板逻辑：动作设置区（随机表演/间隔/趴下站起/重置）+ 全部动作按编号顺序平铺，
// 点击持续播放不关闭面板（便于连续测试）
(function () {
  const $ = (s) => document.querySelector(s);
  const allBox = $('#all-items');
  let cfg = { randomAction: { enabled: true, intervalMin: 10, intervalMax: 30 } };

  // ── 动作设置区：随机表演开关 + 表演间隔区间（步进 5，范围 5-300；min≤max 自动校正）──
  function renderCfg() {
    $('#cfgToggle').textContent = cfg.randomAction.enabled ? '开' : '关';
    $('#cfgToggle').classList.toggle('on', !!cfg.randomAction.enabled);
    $('#cfgMin').textContent = cfg.randomAction.intervalMin;
    $('#cfgMax').textContent = cfg.randomAction.intervalMax;
  }

  function bindCfg() {
    $('#cfgToggle').addEventListener('click', () => {
      cfg.randomAction.enabled = !cfg.randomAction.enabled;
      window.actionPanelApi.setConfig('randomAction.enabled', cfg.randomAction.enabled);
      renderCfg();
    });
    const step = (key, delta) => {
      const v = Math.max(5, Math.min(300, (cfg.randomAction[key] || 10) + delta));
      cfg.randomAction[key] = v;
      if (cfg.randomAction.intervalMin > cfg.randomAction.intervalMax) cfg.randomAction.intervalMin = cfg.randomAction.intervalMax;
      window.actionPanelApi.setConfig('randomAction.intervalMin', cfg.randomAction.intervalMin);
      window.actionPanelApi.setConfig('randomAction.intervalMax', cfg.randomAction.intervalMax);
      renderCfg();
    };
    $('#cfgDecMin').addEventListener('click', () => step('intervalMin', -5));
    $('#cfgIncMin').addEventListener('click', () => step('intervalMin', 5));
    $('#cfgDecMax').addEventListener('click', () => step('intervalMax', -5));
    $('#cfgIncMax').addEventListener('click', () => step('intervalMax', 5));
    // 趴下/站起切换 + 重置动作：走 menu-pick 链路（主进程转发给桌宠渲染层，与旧菜单一致）
    $('#cfgLie').addEventListener('click', () => window.actionPanelApi.pick('TOGGLE_LIE'));
    $('#cfgReset').addEventListener('click', () => window.actionPanelApi.pick('RESET'));
  }

  // 渲染一个动作项：只显示编号（中文名也不需要，纯编号平铺）
  function itemEl(it) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.act = it.id;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = it.num || '';
    div.appendChild(num);
    return div;
  }

  // 点击动作：pick（转发给桌宠播放，面板保持打开）
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    const act = item.dataset.act;
    if (!act) return;
    window.actionPanelApi.pick(act);
  });

  // 标题栏按钮
  $('#btnMin').addEventListener('click', () => window.actionPanelApi.minimize());
  $('#btnClose').addEventListener('click', () => window.actionPanelApi.close());

  // 接收主进程动作数据并渲染：固定动作 + 全部类别动作 合并 → 按编号升序平铺
  window.actionPanelApi.onData((data) => {
    if (data.config) cfg = Object.assign({}, cfg, data.config);
    const all = [];
    for (const it of data.fixed) all.push(it);
    for (const g of data.groups) for (const it of g.items) all.push(it);
    // 去重（固定动作与 act_* 编号不冲突，但保险起见按 id 去重）
    const seen = new Set();
    const merged = [];
    for (const it of all) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      merged.push(it);
    }
    // 编号优先数字升序，无编号（固定动作）排最后
    merged.sort((a, b) => {
      const na = parseInt(a.num, 10);
      const nb = parseInt(b.num, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return (a.id < b.id ? -1 : 1);
    });
    for (const it of merged) allBox.appendChild(itemEl(it));
    renderCfg();
    bindCfg();
  });
})();
