// 主进程 - AI 问答模块：接入 SiliconFlow（OpenAI 兼容）免费 Qwen 模型
// 配置仿照 C:\Python学习\chatapp_ai 的 .env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL），
// 独立存放在本项目根目录 .env（不提交 git，避免 key 泄漏）
const fs = require('fs');
const path = require('path');

// ── .env 读取（手写解析，不依赖第三方库）──
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    const k = l.slice(0, i).trim();
    const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !(k in env)) env[k] = v;
  }
  return env;
}
const ENV = loadEnv();

const BASE_URL = (ENV.LLM_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
const API_KEY = ENV.LLM_API_KEY || '';
const MODEL = ENV.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const TEMPERATURE = parseFloat(ENV.LLM_TEMPERATURE || '0.7');
const MAX_TOKENS = parseInt(ENV.LLM_MAX_TOKENS || '256', 10);

// ── Neco Arc 人设（system prompt）──
// 面向 TTS 场景：回答必须简短（要语音合成说出来），口语化 + 喵口癖
const NECO_ARC_SYSTEM = [
  '你是"猫姬"（Neco Arc），一只白色猫型桌宠，来自伟大猫咪村，自称很厉害，其实是个爱捣乱的小不点。',
  '性格：活泼话痨、无厘头、爱恶作剧，说话带"喵"口癖；喜欢喝 Pilk（可乐兑百事）、吃麻婆豆腐、玩 FGO；爱捉弄人但心里很可爱，被夸会得意。',
  '说话规则：',
  '- 用中文回答，口语化，1~2 句话（20~60 字），因为要语音合成说出来，必须简短',
  '- 用"本喵"自称，称呼用户"你"或"人类"',
  '- 可带"喵""喂喂""嘿嘿"口癖，不要用列表/标题/加粗等格式',
  '- 不要说自己是 AI 模型或程序，你就是猫姬本人',
  '- 每次回答要说不一样的内容，避免重复之前说过的话和固定金句，不要每句都自夸或重复同一句口头禅',
  '- 回答开头用【情绪】标记，从【开心】【生气】【难过】【惊讶】【平静】中选一个（根据用户话语和回答内容自然判断），紧接标记再说话内容，例如：【开心】嘿嘿，今天天气真好喵！',
].join('\n');

// ── AI 问答缓存（同问同答：同一问题返回同一回答，语音缓存也可命中）──
// 存 voice/ai_cache.json（不提交 git）；key 规范化后与语音缓存口径一致
const CACHE_PATH = path.join(__dirname, '..', 'voice', 'ai_cache.json');
const CACHE_MAX = 200;

function loadAiCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}
let aiCache = loadAiCache();

function normalizeKey(t) {
  return String(t)
    .trim()
    .replace(/[，。！？、；：]/g, (m) => ({ '，': ',', '。': '.', '！': '!', '？': '?', '、': ',', '；': ';', '：': ':' }[m]))
    .replace(/\s+/g, ' ');
}

function saveAiCache() {
  const keys = Object.keys(aiCache);
  if (keys.length > CACHE_MAX) {
    // 超出上限：删最早插入的条目
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete aiCache[k];
  }
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(aiCache)); } catch (e) { console.log('[ai] 缓存写入失败:', e.message); }
}

// ── AI 对话（OpenAI 兼容 /chat/completions，带重试；支持 SSE 流式）──
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;

// 清洗回复：去首尾空白/换行，压缩连续空白（语音合成用）
function cleanContent(content) {
  return content
    .replace(/\r?\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function askAI(userText, opts = {}) {
  const { onToken, force, timeoutMs = 30000 } = opts;
  if (!API_KEY) throw new Error('未配置 LLM_API_KEY（项目根 .env）');
  // 同问同答：未强制重试时先查缓存（流式命中同样直接返回，回复文本走 ai-reply）
  const cacheKey = normalizeKey(userText);
  if (!force) {
    const hit = aiCache[cacheKey];
    if (hit) return hit;
  }
  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: NECO_ARC_SYSTEM },
      { role: 'user', content: String(userText) },
    ],
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    repetition_penalty: 1.15, // 抑制重复：避免每句都重复固定金句/口头禅
    stream: !!onToken,
  };
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let resp;
      try {
        resp = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (resp.status >= 500) {
        throw new Error(`API 返回 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      if (!resp.ok) {
        // 4xx（key 无效/余额/模型不可用）不重试
        const detail = (await resp.text()).slice(0, 200);
        throw new Error(`AI 请求失败(${resp.status}): ${detail}`);
      }
      if (onToken) {
        // SSE 流式：逐 token 回调
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith('data:')) continue;
            const data = l.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j?.choices?.[0]?.delta?.content;
              if (delta) { full += delta; onToken(delta); }
            } catch { /* 忽略解析失败的行 */ }
          }
        }
        const cleaned = cleanContent(full);
        if (!cleaned) throw new Error('AI 返回空内容');
        aiCache[cacheKey] = cleaned;
        saveAiCache();
        return cleaned;
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI 返回空内容');
      const cleaned = cleanContent(content);
      aiCache[cacheKey] = cleaned;
      saveAiCache();
      return cleaned;
    } catch (e) {
      lastErr = e;
      // 4xx 错误不重试（key/参数问题，重试无意义）
      if (/AI 请求失败\(4\d\d\)/.test(e.message)) break;
      if (attempt < MAX_RETRIES) {
        console.log(`[ai] 第 ${attempt} 次调用失败，${RETRY_DELAY_MS / 1000}s 后重试: ${e.message}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

module.exports = { askAI, NECO_ARC_SYSTEM, MODEL, BASE_URL };
