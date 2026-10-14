// 主进程 - 猫Arc 知识库检索模块（增强版 RAG：向量语义检索 + 关键词兜底）
// 资料库：assets/arc-knowledge/*.md（按 ## 标题分块，每块一个主题）
// 接口固定：searchKnowledge(query) → [{title, content, score}]
//   增强版内部 = 用户指定的 embedding 模型（面板「知识库（RAG）」配置 kbModel/kbApiKey/kbBaseUrl）
//   向量召回（语义检索，同义换词也能命中）；未配置三字段/无密钥/网络/API 异常
//   自动降级为本地关键词打分检索（免费离线兜底，无需任何模型），不影响问答链路。
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getAssetRoot } = require('./paths');

const KB_DIR = path.join(getAssetRoot(), 'arc-knowledge');
const MAX_HITS = 3;            // 最多注入块数
const MAX_BLOCK_CHARS = 320;   // 每块注入截断长度（控制 token）
// 嵌入缓存（按资料库指纹+模型名分版本，换模型自动重生成）
const EMB_CACHE_PATH = path.join(getAssetRoot(), 'kb_embeddings.json');
const EMB_TIMEOUT_MS = 15000;

let blocksCache = null; // 启动时加载一次，重启刷新（资料库静态，无需热更新）

// 读取资料库 → 按 ## 标题分块（无 ## 时整文件一块）
function loadBlocks() {
  if (blocksCache) return blocksCache;
  const blocks = [];
  if (!fs.existsSync(KB_DIR)) { blocksCache = []; return blocksCache; }
  for (const f of fs.readdirSync(KB_DIR)) {
    if (!f.endsWith('.md')) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(KB_DIR, f), 'utf8'); } catch { continue; }
    const parts = text.split(/^##\s+/m);
    // parts[0] 是 # 主标题（若存在），无子块时作为一块
    const head = text.match(/^#\s+([^\n]+)/m);
    if (parts.length === 1 && head) {
      const body = text.slice(text.indexOf('\n') + 1).trim();
      if (body) blocks.push({ title: head[1].trim(), content: body, file: f });
    }
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const nl = p.indexOf('\n');
      const title = (nl >= 0 ? p.slice(0, nl) : p).trim();
      const body = (nl >= 0 ? p.slice(nl + 1) : '').trim();
      if (!title || !body) continue;
      blocks.push({ title, content: body, file: f }); // content 只存正文，标题单独保留（注入时不重复）
    }
  }
  blocksCache = blocks;
  return blocksCache;
}

// 轻量关键词打分：从 query 提取 2~4 字窗口（去停用词），在块文本中子串匹配，
// 窗口越长权重越高；标题命中额外加权。分数可解释、无需分词库。
const STOP_WORDS = new Set([
  '的', '了', '吗', '呢', '啊', '呀', '喵', '嘛', '哦', '嗯', '吧', '哈',
  '什么', '怎么', '怎样', '如何', '为什么', '是不是', '有没有', '可不可以', '能不能',
  '我', '你', '他', '她', '它', '我们', '你们', '这', '那', '这个', '那个', '一个', '一下',
  '我的', '你好', '怎么办', '怎么', '可以',
  '请问', '说', '知道', '告诉', '介绍', '讲讲', '关于', '会', '能', '想', '要',
]);

function extractTerms(query) {
  const t = String(query || '').trim();
  if (!t) return [];
  const terms = [];
  for (let w = 4; w >= 2; w--) {
    for (let i = 0; i + w <= t.length; i++) {
      const s = t.slice(i, i + w);
      // 只保留含中文的窗口：过滤纯英文/数字碎片（如 "thon"/"on" 会误命中资料库英文招式名）
      if (!/[\u4e00-\u9fa5]/.test(s)) continue;
      if (!STOP_WORDS.has(s) && !/[\s，。！？、；：,.!?;:()（)]$/.test(s.slice(-1))) {
        terms.push(s);
      }
    }
  }
  return [...new Set(terms)];
}

function scoreBlock(block, terms) {
  const title = block.title;
  const content = block.content;
  let score = 0;
  for (const t of terms) {
    if (t.length <= 2) {
      // 2字词只认标题命中：正文子串匹配噪音大（"你好好"含"你好"、"我的责任"含"我的"）
      if (title.includes(t)) score += 3;
      continue;
    }
    if (content.includes(t)) score += t.length; // 长词更具体，权重更高
    if (title.includes(t)) score += t.length + 1; // 标题命中额外加权
  }
  return score;
}

// ── 关键词检索（兜底；与向量检索共用 loadBlocks/extractTerms）──
function keywordSearch(blocks, query) {
  const terms = extractTerms(query);
  if (!blocks.length || !terms.length) return [];
  const scored = blocks
    .map((b) => ({ title: b.title, content: b.content, file: b.file, score: scoreBlock(b, terms) }))
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_HITS).map((b) => ({ title: b.title, content: b.content, score: b.score }));
}

// ── 向量检索（增强版）──
// embedding 配置直接读 assets/ai-config.json 的知识库字段（kbModel/kbApiKey/kbBaseUrl），
// 与 ai.js 无循环依赖（面板保存会同步写文件）；三字段均需用户指定，不留默认/不共用文本生成配置。
function readAiConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ai-config.json'), 'utf8'));
    return {
      model: String(c.kbModel || '').trim(),
      apiKey: String(c.kbApiKey || '').trim(),
      baseUrl: String(c.kbBaseUrl || '').trim().replace(/\/+$/, ''),
    };
  } catch { return { model: '', apiKey: '', baseUrl: '' }; }
}

// 从系统 hosts 文件直接读 IP（curl 能通而 node 解析器 EAI_FAIL 时唯一可靠来源）
function lookupFromHosts(hostname) {
  const hostsPath = process.env.WINDIR ? path.join(process.env.WINDIR, 'System32', 'drivers', 'etc', 'hosts') : '';
  if (!hostsPath || !fs.existsSync(hostsPath)) return null;
  try {
    for (const line of fs.readFileSync(hostsPath, 'utf8').split(/\r?\n/)) {
      const s = line.replace(/#.*$/, '').trim();
      if (!s) continue;
      const m = s.split(/\s+/);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(m[0]) && m.slice(1).some((n) => n.toLowerCase() === hostname.toLowerCase())) return m[0];
    }
  } catch { /* 忽略 */ }
  return null;
}

// 调 SiliconFlow /embeddings（OpenAI 兼容）：入参文本数组 → 返回向量数组
// 注意：Node 原生 fetch 在该环境直连 api.siliconflow.cn 常失败（DNS 解析器损坏，历史坑），
//   IP 来源 = 系统 hosts 文件 → web-search.js 的多源解析（系统 DNS→腾讯→阿里 DoH）→ 抛错降级。
async function embedTexts(texts) {
  const cfg = readAiConfig();
  if (!cfg.model || !cfg.apiKey || !cfg.baseUrl) throw new Error('未配置知识库嵌入模型/密钥/接口');
  const hostname = String(cfg.baseUrl).replace(/^https?:\/\//, '').replace(/\/.*$/, ''); // api.siliconflow.cn
  const apiPath = String(cfg.baseUrl).replace(/^https?:\/\/[^/]+/, '') + '/embeddings';
  const ip = lookupFromHosts(hostname) || await require('./web-search').resolveHost(hostname);
  if (!ip) throw new Error('DNS 解析失败');
  const body = JSON.stringify({ model: cfg.model, input: texts });
  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, port: 443, path: apiPath, method: 'POST', servername: hostname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${cfg.apiKey}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: EMB_TIMEOUT_MS,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
  if (result.status !== 200) throw new Error(`embeddings HTTP ${result.status}: ${String(result.body).slice(0, 140)}`);
  const j = JSON.parse(result.body);
  const vecs = (j.data || []).map((d) => d.embedding);
  if (vecs.length !== texts.length) throw new Error('embeddings 返回数量不匹配');
  return vecs;
}

// 资料库指纹：块标题+正文摘要 + 嵌入模型名参与 hash；
// 资料库变了 / 换了嵌入模型，都重新生成 embedding 缓存（不同模型的向量不可混用）
function kbFingerprint(blocks) {
  const cfg = readAiConfig();
  let h = 5381;
  let s = `model=${cfg.model || 'kw'}|`;
  for (const b of blocks) {
    s += `${b.file}|${b.title}|${b.content.slice(0, 200)}`;
  }
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// 读/写 embedding 缓存（voice/cache 已被 .gitignore 忽略，派生数据不入库）
function loadEmbedCache() {
  try { return JSON.parse(fs.readFileSync(EMB_CACHE_PATH, 'utf8')); } catch { return null; }
}
function saveEmbedCache(cache) {
  try {
    fs.mkdirSync(path.dirname(EMB_CACHE_PATH), { recursive: true });
    fs.writeFileSync(EMB_CACHE_PATH, JSON.stringify(cache));
  } catch (e) { console.log('[knowledge] embedding 缓存写入失败:', e.message); }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// 向量检索主流程：首次生成/资料库变更时批量 embed 全库并缓存；查询只 embed query 后余弦 top-k
let lastVecFailAt = 0; // 失败熔断：网络坏时短暂跳过向量尝试，避免每次问答都白等
const VEC_FAIL_COOLDOWN_MS = 60000;

async function vectorSearch(blocks, query) {
  if (!blocks.length) return [];
  const fp = kbFingerprint(blocks);
  let cache = loadEmbedCache();
  if (!cache || cache.fp !== fp) {
    // 重新生成全库向量（每条截断控制 token；失败则抛错走降级）
    const texts = blocks.map((b) => `${b.title}\n${b.content.slice(0, 600)}`);
    console.log(`[knowledge] 生成知识库向量: ${texts.length} 块 (${readAiConfig().model})`);
    const vecs = await embedTexts(texts);
    cache = { fp, data: blocks.map((b, i) => ({ key: `${b.file}|${b.title}`, vec: vecs[i] })) };
    saveEmbedCache(cache);
  }
  const map = new Map(cache.data.map((d) => [d.key, d.vec]));
  const qVecs = await embedTexts([String(query).slice(0, 200)]);
  const qVec = qVecs[0];
  const scored = blocks
    .map((b) => ({ title: b.title, content: b.content, key: `${b.file}|${b.title}`, vec: map.get(`${b.file}|${b.title}`) }))
    .filter((b) => b.vec)
    .map((b) => ({ title: b.title, content: b.content, score: Number(cosine(b.vec, qVec).toFixed(4)) }))
    .filter((b) => b.score > 0.45) // 相似度阈值：低于此视为无关（0.45 可过滤闲聊/无关问题的低分噪音）
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_HITS);
}

// 检索入口（异步）：优先向量召回（需用户配置嵌入模型/密钥/接口），
// 未配置三字段或任何环节失败 → 本地关键词检索（免费离线兜底）；失败后熔断 60 秒避免重复白等
async function searchKnowledge(query) {
  const blocks = loadBlocks();
  const t = String(query || '').trim();
  if (!blocks.length || t.length < 2) return [];
  const cfg = readAiConfig();
  const vecOk = !!(cfg.model && cfg.apiKey && cfg.baseUrl);
  if (vecOk && Date.now() - lastVecFailAt > VEC_FAIL_COOLDOWN_MS) {
    try {
      const hits = await vectorSearch(blocks, t);
      if (hits && hits.length) return hits;
    } catch (e) {
      lastVecFailAt = Date.now();
      console.log('[knowledge] 向量检索失败，降级关键词:', e.message);
    }
  }
  return keywordSearch(blocks, t);
}

// 命中块 → 注入文本（供 AI 上下文；未命中返回空串）
function formatKnowledge(hits) {
  if (!hits || !hits.length) return '';
  const lines = hits.map((h, i) => `【${h.title}】\n${h.content.slice(0, MAX_BLOCK_CHARS)}`);
  return [
    '[猫Arc知识库资料]（以下是检索到的角色设定资料。仅当用户问题涉及猫姬身份/性格/口癖/招式/关系/世界观等设定时，用它让回答更贴合猫姬人设；与问题无关则忽略。回答仍用猫姬风格、简短、带【情绪】标记）',
    ...lines,
  ].join('\n');
}

// 嵌入配置连通性测试：用当前嵌入模型/密钥/接口对一句文本生成向量，返回维度与耗时（面板「测试嵌入模型」）
async function testEmbedding(text) {
  const cfg = readAiConfig();
  if (!cfg.model || !cfg.apiKey || !cfg.baseUrl) throw new Error('未配置知识库嵌入模型/密钥/接口');
  const t0 = Date.now();
  const vecs = await embedTexts([String(text || '猫姬是谁').slice(0, 200)]);
  return { dim: (vecs[0] || []).length, ms: Date.now() - t0 };
}

module.exports = { searchKnowledge, formatKnowledge, loadBlocks, testEmbedding };
