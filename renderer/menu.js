// 猫姬桌宠 - 自绘右键菜单逻辑：动作模块（常用+分组统合）+ 设置模块（随机播放参数），点击动作回传选择
(function () {
  const $ = (s) => document.querySelector(s);
  const secFixed = $('#sec-fixed');
  const groupsBox = $('#groups');
  const secSing = $('#sec-sing');
  let cfg = { randomAction: { enabled: true, intervalSec: 15 } };

  // 渲染一个动作项
  function itemEl(it, isFunc) {
    const div = document.createElement('div');
    div.className = 'item' + (isFunc ? ' func' : '');
    div.dataset.act = it.id;
    if (!isFunc) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = it.num || '';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = it.label;
      div.appendChild(num);
      div.appendChild(lbl);
    } else {
      const fname = document.createElement('span');
      fname.className = 'fname';
      fname.textContent = it.label;
      div.appendChild(fname);
    }
    return div;
  }

  // 渲染分组（details 折叠）
  function groupEl(g) {
    const det = document.createElement('details');
    det.className = 'fgroup';
    const sum = document.createElement('summary');
    const gt = document.createElement('span');
    gt.className = 'gtitle';
    gt.textContent = g.title;
    const gc = document.createElement('span');
    gc.className = 'gcount';
    gc.textContent = g.items.length;
    const ar = document.createElement('span');
    ar.className = 'arrow';
    ar.textContent = '▶';
    sum.appendChild(gt);
    sum.appendChild(gc);
    sum.appendChild(ar);
    det.appendChild(sum);
    for (const it of g.items) det.appendChild(itemEl(it, false));
    return det;
  }

  // 设置模块 UI 更新
  function renderCfg() {
    $('#cfg-enable-val').textContent = cfg.randomAction.enabled ? '开' : '关';
    $('#cfg-interval').textContent = cfg.randomAction.intervalSec;
    $('#cfg-badge').textContent = '';
  }

  // 设置交互：随机表演开关 / 间隔增减（步进 5，范围 5-120）
  function bindCfg() {
    $('#cfg-enable').addEventListener('click', () => {
      cfg.randomAction.enabled = !cfg.randomAction.enabled;
      window.menuApi.setConfig('randomAction.enabled', cfg.randomAction.enabled);
      renderCfg();
    });
    $('#cfg-dec').addEventListener('click', (e) => {
      e.stopPropagation();
      cfg.randomAction.intervalSec = Math.max(5, cfg.randomAction.intervalSec - 5);
      window.menuApi.setConfig('randomAction.intervalSec', cfg.randomAction.intervalSec);
      renderCfg();
    });
    $('#cfg-inc').addEventListener('click', (e) => {
      e.stopPropagation();
      cfg.randomAction.intervalSec = Math.min(120, cfg.randomAction.intervalSec + 5);
      window.menuApi.setConfig('randomAction.intervalSec', cfg.randomAction.intervalSec);
      renderCfg();
    });
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
    for (const it of data.fixed) secFixed.appendChild(itemEl(it, false));
    for (const g of data.groups) groupsBox.appendChild(groupEl(g));
    const total = data.fixed.length + data.groups.reduce((s, g) => s + g.items.length, 0);
    $('#act-count').textContent = total;
    // 翻唱历史：每首歌一个可点击项（点击 → pick('sing:歌名')），并显示数量
    const hist = data.singHistory || [];
    $('#sing-count').textContent = hist.length;
    for (const h of hist) {
      secSing.appendChild(itemEl({ id: 'sing:' + h.name, label: h.name }, false));
    }
    renderCfg();
    bindCfg();
    bindClick();
  });
})();
