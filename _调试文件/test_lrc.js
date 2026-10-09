// 临时验证脚本：验证 lyric.js 的 parseLrc 逻辑（独立复制，不影响主模块）
const sample = `[ti:晴天]
[00:00.50]故事的小黄花
[00:04.20]从出生那年就飘着
[01:08.80]童年的荡秋千
[01:13.50]随记忆一直晃到现在
[01:45.00]吹着前奏望着天空的我想起花瓣
[01:52.00]试着掉落`;

function parseLrc(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const out = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    const times = [...line.matchAll(re)];
    if (!times.length) continue;
    const content = line.replace(re, '').trim();
    if (!content) continue;
    for (const m of times) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseFloat('0.' + m[3].padEnd(3, '0')) : 0;
      out.push({ time: min * 60 + sec + frac, text: content });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

const r = parseLrc(sample);
console.log('count =', r.length);
for (const x of r) console.log(x.time.toFixed(2), x.text);
// 期望：5 句按时间排序；毫秒 [00:00.50] → 0.5
