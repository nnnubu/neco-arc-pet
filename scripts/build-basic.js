// 开发者一键打包：基础包（electron-builder dir → 改名 NecoArc-Pet → 压缩 zip → 敏感自检）
// 由总面板"生成基础包"按钮触发（仅开发版）；输出 JSON 行 {t,pct} 供主进程转播进度小窗
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pub = path.join('C:\\Users\\nnnubu\\Desktop\\neco arc\\发布包');
const zip = path.join(pub, 'NecoArc-基础包.zip');
const outDir = path.join(dist, 'NecoArc-Pet');

function log(t, pct) { console.log(JSON.stringify({ t, pct: pct == null ? undefined : pct })); }
// 执行命令：stdout 忽略（进度由 log() 上报），stderr 捕获供失败时解码；
// Windows 下系统工具（tar 等）错误消息是 GBK 字节，需用 TextDecoder('gbk') 解码，避免乱码
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

// 1 清理旧构建（防嵌套）
log('清理旧构建目录…', 5);
for (const d of ['NecoArc-Pet', 'win-unpacked']) fs.rmSync(path.join(dist, d), { recursive: true, force: true });

// 2 构建（约 1~3 分钟；构建期间无细分进度，停留在 30% 配合进度小窗转圈）
log('electron-builder 构建中（约 1~3 分钟）…', 30);
try { sh('npm run dist'); } catch (e) { fail('✗ 构建失败：' + String(e.message).split('\n')[0], 30); }
if (!fs.existsSync(path.join(dist, 'win-unpacked'))) fail('✗ 未找到构建产物 dist\\win-unpacked', 30);

// 3 改名
log('整理产物目录…', 55);
fs.renameSync(path.join(dist, 'win-unpacked'), outDir);

// 4 压缩
log('压缩基础包（约 2 分钟）…', 65);
try { sh(`tar -a -c -f "${zip}" -C "${dist}" NecoArc-Pet`); } catch (e) { fail('✗ 压缩失败：' + String(e.message).split('\n')[0], 65); }

// 5 敏感自检
log('敏感文件自检…', 92);
const list = execSync(`tar -tf "${zip}"`, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const hit = list.split('\n').filter((l) => /ai-config\.json|voice-env310|sing_output|\/cache\/|win-unpacked/.test(l));
if (hit.length) log('⚠️ 敏感文件残留：' + hit.slice(0, 3).join('，'), 95);

const sizeMB = Math.round(fs.statSync(zip).size / 1048576);
log(`✓ 完成：NecoArc-基础包.zip ${sizeMB} MB → 发布包目录`, 100);
