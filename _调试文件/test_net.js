// 网络对照实验（Electron 主进程环境运行，模拟桌宠真实网络行为）
// 目的：区分「系统 DNS/网络栈损坏」vs「应用层/编码问题」
// 用法: node_modules\electron\dist\electron.exe _调试文件\test_net.js
const { app } = require('electron');

app.whenReady().then(async () => {
  const out = [];
  const log = (s) => { out.push(s); console.log(s); };

  // 1. hosts 固定域名的域名解析（对照组：应通）
  const dns = require('dns');
  const lookup = (h) => new Promise((r) => dns.lookup(h, { family: 4 }, (e, a) => r(e ? `FAIL ${e.code}` : a)));
  log('1a 系统解析 api.siliconflow.cn : ' + await lookup('api.siliconflow.cn'));
  log('1b 系统解析 www.bing.com      : ' + await lookup('www.bing.com'));
  log('1c 系统解析 music.163.com     : ' + await lookup('music.163.com'));

  // 2. 纯 IP 裸 TCP（完全不依赖 DNS）
  const net = require('net');
  const tcp = (h, p, t = 4000) => new Promise((r) => {
    const s = new net.Socket();
    const tm = setTimeout(() => { s.destroy(); r('超时'); }, t);
    s.on('connect', () => { clearTimeout(tm); s.destroy(); r('连接成功'); });
    s.on('error', (e) => { clearTimeout(tm); r(`${e.code}`); });
    s.connect(p, h);
  });
  log('2a TCP 119.29.29.29:80  : ' + await tcp('119.29.29.29', 80));
  log('2b TCP 47.117.38.205:443(siliconflow IP) : ' + await tcp('47.117.38.205', 443));

  // 3. fetch 真实请求（编码层面验证：返回内容正常才算"非编码问题"）
  log('3a fetch siliconflow /v1/models (hosts) ...');
  try {
    const r = await fetch('https://api.siliconflow.cn/v1/models', { timeout: 6000 });
    log('    -> HTTP ' + r.status + '（401=网络通，仅缺鉴权，属预期）');
  } catch (e) { log('    -> fetch失败: ' + e.message); }
  log('3b fetch bing 搜索页 ...');
  try {
    const r = await fetch('https://www.bing.com/search?q=test&mkt=zh-CN', { timeout: 6000 });
    const t = await r.text();
    log('    -> HTTP ' + r.status + ' 长度=' + t.length);
  } catch (e) { log('    -> fetch失败: ' + e.message); }
  log('3c fetch 网易云歌词API ...');
  try {
    const r = await fetch('https://music.163.com/api/search/get?s=晴天&type=1', { timeout: 6000 });
    log('    -> HTTP ' + r.status);
  } catch (e) { log('    -> fetch失败: ' + e.message); }

  log('===== 结论判断 =====');
  log('- 若 1a/2b/3a 通而 1b/1c/2a/3b/3c 挂 → 系统解析器损坏(仅 hosts 域名可达)，非编码问题');
  log('- 若 3b/3c 也能通 → 网络正常，此前失败为测试环境差异，搜索模块可直接用');
  app.exit(0);
});
