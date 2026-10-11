// 猫姬桌宠 - 动作面板逻辑：常用动作 + 按类别分组，点击动作持续播放不关闭面板（便于连续测试）
(function () {
  const $ = (s) => document.querySelector(s);
  const secFixed = $('#sec-fixed');
  const groupsBox = $('#groups');

  // 渲染一个动作项
  function itemEl(it) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.act = it.id;
    div.title = it.label;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = it.num || '';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = it.label;
    div.appendChild(num);
    div.appendChild(lbl);
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
    const box = document.createElement('div');
    box.className = 'items';
    for (const it of g.items) box.appendChild(itemEl(it));
    det.appendChild(box);
    return det;
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

  // 接收主进程动作数据并渲染
  window.actionPanelApi.onData((data) => {
    for (const it of data.fixed) secFixed.appendChild(itemEl(it));
    for (const g of data.groups) groupsBox.appendChild(groupEl(g));
  });
})();
