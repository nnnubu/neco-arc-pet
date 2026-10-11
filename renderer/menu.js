// 猫姬桌宠 - 自绘右键菜单逻辑：动作面板入口 + 设置模块（随机播放参数），点击功能项回传选择
(function () {
  const $ = (s) => document.querySelector(s);
  const secSing = $('#sec-sing');
  let cfg = { randomAction: { enabled: true, intervalSec: 15 } };

  // 渲染一个功能项
  function funcEl(it) {
    const div = document.createElement('div');
    div.className = 'item func';
    div.dataset.act = it.id;
    const fname = document.createElement('span');
    fname.className = 'fname';
    fname.textContent = it.label;
    div.appendChild(fname);
    return div;
  }

  // 设置模块 UI 更新
  function renderCfg() {
    $('#cfg-enable-val').textContent = cfg.randomAction.enabled ? '开' : '关';
    $('#cfg-min').textContent = cfg.randomAction.intervalMin;
    $('#cfg-max').textContent = cfg.randomAction.intervalMax;
    $('#cfg-badge').textContent = '';
  }

  // 设置交互：随机表演开关 / 间隔区间增减（步进 5，范围 5-300；min≤max 自动校正）
  function bindCfg() {
    $('#cfg-enable').addEventListener('click', () => {
      cfg.randomAction.enabled = !cfg.randomAction.enabled;
      window.menuApi.setConfig('randomAction.enabled', cfg.randomAction.enabled);
      renderCfg();
    });
    const step = (key, delta) => {
      const v = Math.max(5, Math.min(300, (cfg.randomAction[key] || 10) + delta));
      cfg.randomAction[key] = v;
      if (cfg.randomAction.intervalMin > cfg.randomAction.intervalMax) cfg.randomAction.intervalMin = cfg.randomAction.intervalMax;
      window.menuApi.setConfig('randomAction.intervalMin', cfg.randomAction.intervalMin);
      window.menuApi.setConfig('randomAction.intervalMax', cfg.randomAction.intervalMax);
      renderCfg();
    };
    $('#cfg-dec-min').addEventListener('click', (e) => { e.stopPropagation(); step('intervalMin', -5); });
    $('#cfg-inc-min').addEventListener('click', (e) => { e.stopPropagation(); step('intervalMin', 5); });
    $('#cfg-dec-max').addEventListener('click', (e) => { e.stopPropagation(); step('intervalMax', -5); });
    $('#cfg-inc-max').addEventListener('click', (e) => { e.stopPropagation(); step('intervalMax', 5); });
  }

  // 点击选择：动作项 / 功能项统一走 pick
  function bindClick() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item || item.classList.contains('cfg') || item.classList.contains('cfg-row')) return;
      const act = item.dataset.act;
      if (!act) return;
      window.menuApi.pick(act);
    });
  }

  // 接收主进程菜单数据并渲染
  window.menuApi.onData((data) => {
    if (data.config) cfg = Object.assign({}, cfg, data.config);
    // 翻唱历史：每首歌一个可点击项（点击 → pick('sing:歌名')），并显示数量
    const hist = data.singHistory || [];
    $('#sing-count').textContent = hist.length;
    for (const h of hist) {
      secSing.appendChild(funcEl({ id: 'sing:' + h.name, label: h.name }));
    }
    renderCfg();
    bindCfg();
    bindClick();
  });
})();
