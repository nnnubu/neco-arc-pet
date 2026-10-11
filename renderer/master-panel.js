// 总面板渲染层：导航点击切换模块 + 最小化/关闭 + 高亮当前模块
const items = Array.from(document.querySelectorAll('.nav-item'));

function setActive(name) {
  items.forEach((b) => b.classList.toggle('active', b.dataset.mod === name));
}

items.forEach((b) => {
  b.addEventListener('click', () => {
    setActive(b.dataset.mod);
    window.masterApi.nav(b.dataset.mod);
  });
});

document.getElementById('btnMin').addEventListener('click', () => window.masterApi.minimize());
document.getElementById('btnClose').addEventListener('click', () => window.masterApi.close());
// 退出桌宠：主进程走退出动画链路（播完由桌宠渲染层发 quit 真正退出）
document.getElementById('btnQuit').addEventListener('click', () => window.masterApi.quit());

window.masterApi.onActive((name) => setActive(name));

// 默认高亮对话模块（主进程 openModule 会再推一次，这里兜底）
setActive('chat');
