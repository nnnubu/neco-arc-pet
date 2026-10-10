// 临时修复脚本：从 .env 恢复密钥/模型到 ai-config.json（修复测试污染）
const fs = require('fs');
const path = require('path');
const dir = process.cwd();

const env = {};
for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) {
  const s = l.trim();
  if (!s || s.startsWith('#') || !s.includes('=')) continue;
  const i = s.indexOf('=');
  env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const cfgPath = path.join(dir, 'assets', 'ai-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const before = { apiKey: cfg.apiKey, model: cfg.model };
cfg.apiKey = cfg.apiKey || env.LLM_API_KEY || '';
cfg.model = cfg.model || env.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('修复前:', JSON.stringify(before));
console.log('修复后: apiKey=' + (cfg.apiKey ? cfg.apiKey.slice(0, 8) + '...(len ' + cfg.apiKey.length + ')' : '空') + ' model=' + cfg.model);
