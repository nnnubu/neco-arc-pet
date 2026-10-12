// 开发者一键打包：语音扩展包（voice/ + voice-env310/ → zip）
// 由总面板"生成语音扩展包"按钮触发（仅开发版）；输出 JSON 行 {t,pct} 供主进程转播进度小窗
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join('C:\\Users\\nnnubu\\Desktop\\neco arc\\发布包');
const zip = path.join(pub, 'NecoArc-语音扩展包.zip');

function log(t, pct) { console.log(JSON.stringify({ t, pct: pct == null ? undefined : pct })); }
function sh(cmd) {
  return execSync(cmd, { cwd: root, shell: true, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
}
function fail(t, pct) { log(t, pct); process.exit(1); }

for (const d of ['voice', 'voice-env310']) {
  if (!fs.existsSync(path.join(root, d))) fail(`✗ 缺少 ${d}\\ 目录——语音扩展包需在已装语音引擎的开发目录生成`, 10);
}

log('正在打包语音扩展包（voice + voice-env310，约 3.8GB，需几分钟）…', 30);
try { sh(`tar -a -c -f "${zip}" voice voice-env310`); } catch (e) { fail('✗ 打包失败：' + String(e.message).split('\n')[0], 30); }

const sizeMB = Math.round(fs.statSync(zip).size / 1048576);
log(`✓ 完成：NecoArc-语音扩展包.zip ${sizeMB} MB → 发布包目录`, 100);
