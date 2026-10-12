// 开发者一键打包：基础包（electron-builder dir → 改名 NecoArc-Pet → 压缩 zip → 敏感自检）
// 由总面板"生成基础包"按钮触发（仅开发版）；输出 JSON 行 {t:…} 供主进程转播状态
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const pub = path.join('C:\\Users\\nnnubu\\Desktop\\neco arc\\发布包');
const zip = path.join(pub, 'NecoArc-基础包.zip');
const outDir = path.join(dist, 'NecoArc-Pet');

function log(t) { console.log(JSON.stringify({ t })); }
function sh(cmd, opts) { return execSync(cmd, Object.assign({ cwd: root, shell: true, stdio: ['ignore', 'ignore', 'pipe'] }, opts || {})); }
function fail(t) { log(t); process.exit(1); }

// 1 清理旧构建（防嵌套）
log('清理旧构建目录…');
for (const d of ['NecoArc-Pet', 'win-unpacked']) fs.rmSync(path.join(dist, d), { recursive: true, force: true });

// 2 构建（约 1~3 分钟；镜像变量仅供网络受限环境，本机已缓存可忽略）
log('electron-builder 构建中（约 1~3 分钟）…');
try { sh('npm run dist'); } catch (e) { fail('构建失败：' + String(e.message).split('\n')[0]); }
if (!fs.existsSync(path.join(dist, 'win-unpacked'))) fail('未找到构建产物 dist\\win-unpacked');

// 3 改名
log('整理产物目录…');
fs.renameSync(path.join(dist, 'win-unpacked'), outDir);

// 4 压缩
log('压缩基础包（约 2 分钟）…');
try { sh(`tar -a -c -f "${zip}" -C "${dist}" NecoArc-Pet`); } catch (e) { fail('压缩失败：' + String(e.message).split('\n')[0]); }

// 5 敏感自检
const list = sh(`tar -tf "${zip}"`, { encoding: 'utf8' });
const hit = list.split('\n').filter((l) => /ai-config\.json|voice-env310|sing_output|\/cache\/|win-unpacked/.test(l));
if (hit.length) log('⚠️ 敏感文件残留：' + hit.slice(0, 3).join('，'));
else log('✓ 敏感文件自检通过');

const sizeMB = Math.round(fs.statSync(zip).size / 1048576);
log(`完成：NecoArc-基础包.zip ${sizeMB} MB → 发布包目录`);
