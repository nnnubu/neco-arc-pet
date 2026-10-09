// 猫姬桌宠 - 自绘右键菜单逻辑：接收主进程菜单数据并渲染，点击动作回传选择
(function () {
  const $ = (s) => document.querySelector(s);
  const secFixed = $('#sec-fixed');
  const groupsBox = $('#groups');

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

  // 点击选择：固定项 / 分组项 / 功能项统一走 pick
  function bindClick() {
    document.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      const act = item.dataset.act;
      if (!act) return;
      window.menuApi.pick(act);
    });
  }

  // 接收主进程菜单数据并渲染
  window.menuApi.onData((data) => {
    for (const it of data.fixed) secFixed.appendChild(itemEl(it, false));
    for (const g of data.groups) groupsBox.appendChild(groupEl(g));
    bindClick();
  });

  // 菜单窗口内点击空白区域不关闭（避免误触），由主进程失焦关闭
})();
