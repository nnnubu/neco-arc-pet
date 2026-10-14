// 开发者一键打包：语音扩展包（voice/ + voice-env310/ → zip）
// 由总面板"生成语音扩展包"按钮触发（仅开发版）；输出 JSON 行 {t,pct} 供主进程转播进度小窗
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 发布包目录：项目容器根（neco arc/发布包）；相对定位，避免硬编码旧桌面路径在项目移动后失效
const pub = path.join(__dirname, '..', '..', '发布包');
const zip = path.join(pub, 'NecoArc-语音扩展包.zip');

function log(t, pct) { console.log(JSON.stringify({ t, pct: pct == null ? undefined : pct })); }
function sh(cmd) {
  try {
    return execSync(cmd, { cwd: root, shell: true, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  } catch (e) {
    let msg = String((e && e.message) || '未知错误');
    if (e && Buffer.isBuffer(e.stderr)) {
      try { msg = new TextDecoder('gbk').decode(e.stderr).trim().split('\n')[0] || msg; } catch (_) {}
    }
    throw new Error(msg);
  }
}
function fail(t, pct) { log(t, pct); process.exit(1); }

// 发布包目录可能被用户删除——自动重建
fs.mkdirSync(pub, { recursive: true });

for (const d of ['voice', 'voice-env310']) {
  if (!fs.existsSync(path.join(root, d))) fail(`✗ 缺少 ${d}\\ 目录——语音扩展包需在已装语音引擎的开发目录生成`, 10);
}

// 打包排除：用户作品（翻唱/语音合成输出）与运行时缓存/日志不进语音扩展包，
// 否则会把开发者的个人作品发给所有用户，且白白增大包体
const EXCLUDES = [
  'voice/sing_output',  // 翻唱输出（用户作品）
  'voice/tts_output',   // 语音合成输出（用户作品）
  'voice/cache',        // 运行时缓存
  'voice/tmp', 'voice/output', 'voice/__pycache__',
  'voice/*.log', 'voice/ai_cache.json', 'voice/actions.log',
  // 旧 venv 残留（Scripts 启动器 + 空壳 site-packages）：新语音包用独立 python（voice-env310\python），
  // venv 曾因 pyvenv.cfg 硬编码开发机 Python 路径导致换机后 "No Python at ..." 启动失败，不再打包
  'voice-env310/Scripts', 'voice-env310/Lib',
  // 运行时字节码缓存：不进包（首次运行自动重新生成），可省数百 MB
  '__pycache__', '*.pyc',
];
const exArgs = EXCLUDES.map((p) => `--exclude="${p}"`).join(' ');

log('正在打包语音扩展包（voice 引擎 + voice-env310，已排除翻唱/语音输出与缓存，约 4GB，需几分钟）…', 30);
try { sh(`tar -a -c ${exArgs} -f "${zip}" voice voice-env310`); } catch (e) { fail('✗ 打包失败：' + String(e.message).split('\n')[0], 30); }

const sizeMB = Math.round(fs.statSync(zip).size / 1048576);
log(`✓ 完成：NecoArc-语音扩展包.zip ${sizeMB} MB → 发布包目录`, 100);
