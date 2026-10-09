// 临时验证脚本：mock electron 环境加载 main 全部模块，验证循环依赖/顶层引用完整性
// 运行：node _调试文件\test_module_load.js
const path = require('path');
const Module = require('module');

const mockElectron = {
  app: {
    on: () => {},
    whenReady: () => Promise.resolve(),
    quit: () => {},
    disableHardwareAcceleration: () => {},
  },
  BrowserWindow: class {
    constructor() { this.webContents = { send: () => {}, on: () => {}, once: () => {} }; }
    loadFile() { return Promise.resolve(); }
    on() {}
    once() {}
    isDestroyed() { return true; }
    show() {}
    hide() {}
    focus() {}
    destroy() {}
    setAlwaysOnTop() {}
  },
  ipcMain: { on: () => {}, handle: () => {} },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  shell: { openPath: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { on: () => {}, send: () => {}, invoke: async () => {} },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return 'electron-mock';
  return origResolve.call(this, request, ...args);
};
require.cache['electron-mock'] = {
  id: 'electron-mock', filename: 'electron-mock', loaded: true, exports: mockElectron,
};

const base = path.join(__dirname, '..', 'main');
const mods = ['window', 'ai', 'voice', 'lyric', 'sing', 'sing-panel', 'chat', 'menu', 'index'];
let ok = true;
for (const m of mods) {
  try {
    const mod = require(path.join(base, m + '.js'));
    console.log('loaded OK:', m, Object.keys(mod).join(','));
  } catch (e) {
    ok = false;
    console.log('LOAD FAIL:', m, e.message);
  }
}
console.log(ok ? 'ALL_MODULES_OK' : 'HAS_FAILURES');
