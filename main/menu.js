// 主进程 - 右键菜单模块：动作菜单模板，点击后向渲染层发送 menu-action
const { ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { getWin } = require('./window');

// 读取迁移动作注册表（assets/sprite/actions.json，由迁移脚本生成）
function loadActions() {
  try {
    const p = path.join(__dirname, '..', 'assets', 'sprite', 'actions.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [];
  }
}

function registerMenuIpc() {
  // 渲染层取动作列表（sprite.js 动态注册 act_* 帧组）
  ipcMain.handle('get-actions', () => {
    const acts = loadActions();
    try {
      fs.appendFileSync(path.join(__dirname, '..', 'voice', 'actions.log'),
        `${new Date().toISOString()} get-actions: ${acts.length} 个动作\n`);
    } catch {}
    return acts;
  });

  ipcMain.on('show-context-menu', () => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    const send = (name) => win.webContents.send('menu-action', name);
    const template = [
      { label: 'Thinking（思考）', click: () => send('thinking') },
      { label: 'Backflip（后空翻）', click: () => send('backflip') },
      { label: 'Kick（踢）', click: () => send('kick') },
      { label: 'Wine（饮酒）', click: () => send('wine') },
      { label: 'Wine2（饮酒2）', click: () => send('wine_2') },
      { type: 'separator' },
      { label: 'Smug（得意）', click: () => send('smug') },
      { label: 'Tongue（吐舌）', click: () => send('tongue') },
      { label: 'Push（推手）', click: () => send('push') },
      { label: 'Star（星星眼）', click: () => send('star') },
      { label: 'Pose1（比1）', click: () => send('pose1') },
      { label: 'Hide（挡脸）', click: () => send('hide') },
      { label: 'Pout（撇嘴）', click: () => send('pout') },
      { label: 'Lie（躺倒）', click: () => send('lie') },
      { type: 'separator' },
      { label: '说句话…', click: () => send('SPEAK') },
      { type: 'separator' },
      { label: '重置动作', click: () => send('RESET') },
      { type: 'separator' },
      { label: '退出桌宠', click: () => require('electron').app.quit() },
    ];

    // 迁移动作（act_*）：按编号每 10 个一组放入「更多动作」子菜单（测试用）
    const acts = loadActions();
    if (acts.length) {
      const sorted = [...acts].sort((a, b) => parseInt(a.name.slice(4)) - parseInt(b.name.slice(4)));
      const groups = [];
      let group = [];
      let gStart = null;
      for (const a of sorted) {
        const n = parseInt(a.name.slice(4));
        if (gStart === null) gStart = n;
        if (group.length && n - gStart >= 10) {
          groups.push({ gStart, gEnd: parseInt(group[group.length - 1].name.slice(4)), items: group });
          group = []; gStart = n;
        }
        group.push(a);
      }
      if (group.length) groups.push({ gStart, gEnd: parseInt(group[group.length - 1].name.slice(4)), items: group });
      const submenu = groups.map((g) => ({
        label: `动作 ${g.gStart}-${g.gEnd}`,
        submenu: g.items.map((a) => ({ label: `动作 ${a.name.slice(4)}（${a.frames}帧）`, click: () => send(a.name) })),
      }));
      template.push({ label: `更多动作（${acts.length}）`, submenu });
    }

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

module.exports = { registerMenuIpc };
