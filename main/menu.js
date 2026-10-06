// 主进程 - 右键菜单模块：动作菜单模板，点击后向渲染层发送 menu-action
const { ipcMain, Menu } = require('electron');
const { getWin } = require('./window');

function registerMenuIpc() {
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
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

module.exports = { registerMenuIpc };
