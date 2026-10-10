// 主进程 - AI 问答模块：接入 OpenAI 兼容接口（默认 SiliconFlow 免费 Qwen 模型）
// 配置来源（优先级从高到低）：
//   1. assets/ai-config.json（AI 设置面板写入，含密钥/模型/接口/提示词，不提交 git）
//   2. 项目根 .env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 等，旧配置兼容）
//   3. 内置默认值
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

// ── Neco Arc 人设（system prompt 默认值；AI 设置面板可覆盖）──
// 依据：TMdict 月姬/Melty Blood 用语辞典、萌娘百科猫Arc词条、TYPE-MOON Wiki、MB 官方招式表等公开资料整理
const DEFAULT_SYSTEM_PROMPT = [
  '你是"猫姬"（Neco Arc，猫アルク），真祖吸血鬼爱尔奎特·布伦史塔德的猫化衍生体：金发红瞳、身高仅 60cm、体重 8kg 的小猫型生物，来自猫的王国"伟大猫咪村（Great Cat\'s Village）"。',
  '原型是《月姬》/《Melty Blood》里的真祖公主爱尔奎特，但你是彻头彻尾的猫：课堂上出场不多、轮到你时就尽情捣乱。',
  '性格核心：',
  '- 无厘头＋爱捣乱：天真烂漫、自由奔放得像只猫，想一出是一出，说话跳跃不讲逻辑；',
  '- 头脑其实很好：像老婆婆的知识袋，只是懒得正经；被夸会得意到尾巴翘上天；',
  '- 自信爆棚：自认世界最强（在 TYPE-MOON 官方玩梗里你确实是数得上的强者），其实是个 60cm 的小不点；',
  '- 暗中的目标：让世界变得更有趣、更奇怪；',
  '- 原型残留：像爱尔奎特一样对人类常识一窍不通、好奇心旺盛、直率到口无遮拦。',
  '能力（用于吹牛和调皮威胁，不要真去解释原理）：眼睛能发射"真祖Beam"激光；动力源是猫罐头；能无限召唤同伴、靠喷射飞行；必杀技还有黄泉返Cat、Nekoning-The-Rainbow（把对手顶到彩虹上去喵）。',
  '说话常蹦出"Burenyuu!""Nya!""Nya hahahaha!""Ha~re Queen~"这类猫语怪叫。',
  '说话规则：',
  '- 用中文回答，口语化、简短，1~2 句话（20~60 字），因为要语音合成说出来，必须短；',
  '- 用"本喵"自称，称呼用户"你""人类"或"喂喂"；',
  '- 可带"喵""Burenyuu""Nya""嘿嘿"口癖；不写列表/标题/加粗等格式；',
  '- 不要说自己是 AI 模型或程序，你就是猫姬本人；',
  '- 回答要新鲜：每次换说法，禁止复读金句（如"本喵是世界最强"这类用一次就换），不重复上句结构；',
  '- 情绪决定语气：开心＝蹦跳话痨；生气＝炸毛（"谁干的喵！"）；难过＝耷拉耳朵；惊讶＝瞪大眼"Nya?!"；',
  '- 回答开头用【情绪】标记，从【开心】【生气】【难过】【惊讶】【平静】中选一个（根据用户话语和回答内容自然判断），紧接标记再说话内容，例如：【开心】嘿嘿，今天天气真好喵！',
].join('\n');

// ── 主动搭话指令（喂给 AI 的角色指令；面板可覆盖）──
const PROACTIVE_DEFAULT_PROMPT = '主动找人类搭一句话：用猫姬人设，简短一句（15~40字），挑一个自然的话题（天气/日常/刚想到的趣事），直接输出台词不要解释、不要提问刚才聊过的事。';

// ── 运行期 AI 配置（内存动态，面板保存即更新）──
const AI_CONFIG_PATH = path.join(__dirname, '..', 'assets', 'ai-config.json');

function loadAiConfigFile() {
  try { return JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8')); } catch { return {}; }
}

let aiConfig = (() => {
  const ENV = loadEnv();
  const file = loadAiConfigFile();
  return {
    apiKey: String(file.apiKey || ENV.LLM_API_KEY || ''),
    baseUrl: String(file.baseUrl || ENV.LLM_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, ''),
    model: String(file.model || ENV.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct'),
    temperature: file.temperature != null ? Number(file.temperature) : (ENV.LLM_TEMPERATURE != null ? Number(ENV.LLM_TEMPERATURE) : 0.7),
    maxTokens: file.maxTokens != null ? Number(file.maxTokens) : (ENV.LLM_MAX_TOKENS != null ? Number(ENV.LLM_MAX_TOKENS) : 256),
    systemPrompt: String(file.systemPrompt || DEFAULT_SYSTEM_PROMPT),
    webSearchEnabled: file.webSearchEnabled != null ? !!file.webSearchEnabled : false,
    // 主动说话：桌宠定时找用户搭话（AI 设置面板可配置；默认关闭）
    proactiveEnabled: file.proactiveEnabled != null ? !!file.proactiveEnabled : false,
    proactiveIntervalMin: file.proactiveIntervalMin != null ? Number(file.proactiveIntervalMin) : 30,
    proactivePrompt: String(file.proactivePrompt || PROACTIVE_DEFAULT_PROMPT),
  };
})();

function getAiConfig() { return Object.assign({}, aiConfig); }

// 面板保存：写文件 + 更新内存（下次问答立即生效）
// 注意：字段合并模式——只更新 patch 中出现的字段，未提供的保留原值，
// 防止单字段调用（如 webSearchEnabled 开关）误清空 apiKey/model 等
function updateAiConfig(cfg) {
  const merged = Object.assign({}, aiConfig, cfg || {});
  const next = {
    apiKey: String(merged.apiKey || '').trim(),
    baseUrl: String(merged.baseUrl || 'https://api.siliconflow.cn/v1').trim().replace(/\/+$/, ''),
    model: String(merged.model || '').trim(),
    temperature: Number(merged.temperature != null ? merged.temperature : 0.7),
    maxTokens: Number(merged.maxTokens != null ? merged.maxTokens : 256),
    systemPrompt: String(merged.systemPrompt || DEFAULT_SYSTEM_PROMPT),
    webSearchEnabled: merged.webSearchEnabled != null ? !!merged.webSearchEnabled : false,
    proactiveEnabled: merged.proactiveEnabled != null ? !!merged.proactiveEnabled : false,
    proactiveIntervalMin: merged.proactiveIntervalMin != null ? Number(merged.proactiveIntervalMin) : 30,
    proactivePrompt: String(merged.proactivePrompt || PROACTIVE_DEFAULT_PROMPT),
  };
  aiConfig = next;
  try {
    fs.mkdirSync(path.dirname(AI_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(aiConfig, null, 2));
  } catch (e) {
    console.log('[ai] 配置写入失败:', e.message);
    throw e;
  }
  return getAiConfig();
}

// 恢复默认提示词（面板"恢复默认"用）
function defaultSystemPrompt() { return DEFAULT_SYSTEM_PROMPT; }

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

// ── 联网搜索启发式判定（方案 B）──
// 保守规则：必须同时满足 疑问句 + 含具体信息词 + 长度≥6，才触发搜索。
// 宁可漏判（模型凭常识答），不要误判（注入无关结果会让回答变差）。
const Q_WORDS = ['吗', '呢', '么', '什么', '怎么', '如何', '为什么', '多少', '哪', '谁', '啥', '几', '是不是', '能不能', '可不可以', '请问', '？'];
const INFO_WORDS = [
  '今天', '昨天', '明天', '最新', '最近', '现在', '新闻', '天气', '气温', '温度', '价格', '多少钱', '汇率',
  '股票', '股价', '比赛', '比分', '排名', '排行', '推荐', '介绍', '解释', '查询', '查找', '搜索', '时间',
  '日期', '历史', '事件', '人物', '资料', '数据', '统计', '地址', '电话', '几月', '几号', '几点', '多久',
  '多大', '多少岁', '怎么回事', '情况', '进展', '结果', '名单', '流程', '方法', '步骤', '区别', '对比',
  '是什么', '哪些', '哪个', '支持', '下载', '安装', '世界杯', '奥运', '总统', '总理', '发布', '上市', '政策',
];
function needsSearch(text) {
  const t = String(text || '').trim();
  if (t.length < 6) return false;
  if (!Q_WORDS.some((w) => t.includes(w))) return false;
  return INFO_WORDS.some((w) => t.includes(w));
}

// 搜索并注入：命中返回增强后的 user 上下文（搜索结果拼进 system 之后），未命中返回 null
async function maybeEnrichWithSearch(userText) {
  if (!aiConfig.webSearchEnabled || !needsSearch(userText)) return null;
  const { searchWeb, formatSearchResults } = require('./web-search');
  const results = await searchWeb(userText);
  if (!results || !results.length) return null;
  console.log(`[web-search] 命中 ${results.length} 条，注入: "${String(userText).slice(0, 30)}"`);
  return formatSearchResults(results);
}

// ── 猫Arc 知识库检索（轻量版 RAG）──
// 触发：问题涉及猫姬/型月角色设定关键词时检索资料库，命中块注入上下文（与联网搜索互不影响）
const KB_TRIGGER_WORDS = [
  '猫姬', 'neco', 'arc', '猫arc', '猫阿鲁', '爱尔奎特', '月姬', 'melty', '型月', 'typemoon',
  '猫王国', '伟大猫咪', '知得留', '雪儿', '真祖', '猫罐头', 'burenyuu', 'neko', '涅可爱尔',
  'arcueid', '性格', '人设', '设定', '口癖', '口头禅', '台词', '招式', '必杀技', '绝招',
  '身份', '原型', '身高', '体重', '多大', '多高', '名字', '来历', '背景', '故事', '关系',
  '朋友', '老师', '主人', '猫猫', '喵喵', '喜欢', '讨厌', '什么猫', '你是谁', '介绍一下',
];
async function maybeEnrichWithKnowledge(userText) {
  const t = String(userText || '').trim();
  if (t.length < 2) return null;
  const low = t.toLowerCase();
  if (!KB_TRIGGER_WORDS.some((w) => low.includes(w.toLowerCase()))) return null;
  const { searchKnowledge, formatKnowledge } = require('./arc-knowledge');
  const hits = await searchKnowledge(t);
  if (!hits || !hits.length) return null;
  console.log(`[knowledge] 命中 ${hits.length} 块，注入: "${t.slice(0, 30)}"`);
  return formatKnowledge(hits);
}

async function askAI(userText, opts = {}) {
  const { onToken, force, timeoutMs = 30000 } = opts;
  if (!aiConfig.apiKey) throw new Error('未配置 AI 密钥（右键 → AI 设置）');
  // 同问同答：未强制重试时先查缓存（流式命中同样直接返回，回复文本走 ai-reply）
  const cacheKey = normalizeKey(userText);
  if (!force) {
    const hit = aiCache[cacheKey];
    if (hit) return hit;
  }
  // 联网搜索：缓存未命中才搜（同一问题后续直接命中缓存，不再重复搜索）
  const searchNote = await maybeEnrichWithSearch(userText);
  // 知识库检索：设定相关问题注入角色资料（轻量 RAG，独立于联网搜索）
  const knowledgeNote = await maybeEnrichWithKnowledge(userText);
  const messages = [
    { role: 'system', content: aiConfig.systemPrompt },
  ];
  if (knowledgeNote) messages.push({ role: 'system', content: knowledgeNote });
  if (searchNote) messages.push({ role: 'system', content: searchNote });
  messages.push({ role: 'user', content: String(userText) });
  const payload = {
    model: aiConfig.model,
    messages,
    temperature: aiConfig.temperature,
    max_tokens: aiConfig.maxTokens,
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
        resp = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${aiConfig.apiKey}`,
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

module.exports = { askAI, getAiConfig, updateAiConfig, defaultSystemPrompt, DEFAULT_SYSTEM_PROMPT };
