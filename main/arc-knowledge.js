// 主进程 - 猫Arc 知识库检索模块（轻量版 RAG：关键词打分检索）
// 资料库：assets/arc-knowledge/*.md（按 ## 标题分块，每块一个主题）
// 接口固定：searchKnowledge(query) → [{title, content, score}]
//   轻量版内部 = 关键词子串加权打分；将来升级向量语义检索时只换内部实现，调用方（ai.js）零改动
const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '..', 'assets', 'arc-knowledge');
const MAX_HITS = 3;           // 最多注入块数
const MAX_BLOCK_CHARS = 320;  // 每块注入截断长度（控制 token）

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

// 检索：返回按分数降序的命中块（分数>0 才算命中）
function searchKnowledge(query) {
  const blocks = loadBlocks();
  const terms = extractTerms(query);
  if (!blocks.length || !terms.length) return [];
  const scored = blocks
    .map((b) => ({ title: b.title, content: b.content, file: b.file, score: scoreBlock(b, terms) }))
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_HITS).map((b) => ({ title: b.title, content: b.content, score: b.score }));
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

module.exports = { searchKnowledge, formatKnowledge, loadBlocks };
