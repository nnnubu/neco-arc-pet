// 主进程 - 联网搜索模块（方案 B：启发式判定 → 搜索 → 注入 AI 上下文）
// 搜索源：必应网页搜索（免费无 key）。
// DNS 加固：系统 getaddrinfo 可能损坏（用户环境曾出现 EAI_FAIL/ENOTSOCK），
//   解析顺序 = 系统 DNS → 腾讯明文 DoH(http://119.29.29.29) → 阿里 DoH(https://223.5.5.5)；
//   解析到 IP 后走 https.request(IP + TLS servername + Host 头) 直连，绕过系统解析器。
// 任何环节失败都返回 []，调用方忽略即可，不影响正常问答链路。
const https = require('https');
const http = require('http');
const dns = require('dns');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 7000;
const MAX_RESULTS = 4;

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 解析必应 HTML：提取 b_algo 结果块（标题 + 摘要 + URL）
function parseBingHtml(html) {
  const results = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    const titleM = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                   block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const hrefM = block.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    const captionM = block.match(/<div class="b_caption"[\s\S]*?>([\s\S]*?)<\/div>/i);
    const pM = captionM ? captionM[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i) : null;
    const title = titleM ? stripHtml(titleM[1]) : '';
    const url = hrefM ? hrefM[1] : '';
    const snippet = stripHtml(pM ? pM[1] : (captionM ? captionM[1] : ''));
    if (!title || !/^https?:\/\//.test(url)) continue;
    results.push({
      title: title.slice(0, 60),
      snippet: snippet.slice(0, 160),
      url: url.split('&')[0],
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

// ── DNS 解析（多源容错）──
function lookupSystem(host) {
  return new Promise((resolve) => {
    dns.lookup(host, { family: 4 }, (err, addr) => resolve(err ? null : addr));
  });
}

// 通用 HTTP(S) GET → 文本（IP 直连，host/servername 透传；用于 DoH 与必应请求）
function getText(host, path, headers, sni, useHttps) {
  return new Promise((resolve, reject) => {
    const mod = useHttps ? https : http;
    const req = mod.get({
      host, path,
      headers,
      timeout: TIMEOUT_MS,
      ...(useHttps && sni ? { servername: sni } : {}),
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// 腾讯 DNSPod 明文 DoH：http://119.29.29.29/d?dn=host&type=A → 多行 IP
async function lookupTencent(host) {
  try {
    const { status, body } = await getText('119.29.29.29', `/d?dn=${encodeURIComponent(host)}&type=A`, { 'User-Agent': UA }, host, false);
    if (status !== 200) return null;
    const ips = String(body).split(/[;\s]+/).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
    return ips[0] || null;
  } catch { return null; }
}

// 阿里 DoH：https://223.5.5.5/resolve?name=host&type=A → JSON（需 SNI 证书匹配，可能失败，作为末位兜底）
async function lookupAli(host) {
  try {
    const { status, body } = await getText('223.5.5.5', `/resolve?name=${encodeURIComponent(host)}&type=A`, { accept: 'application/dns-json' }, '223.5.5.5', true);
    if (status !== 200) return null;
    const j = JSON.parse(body);
    const a = (j.Answer || []).find((x) => x.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(x.data));
    return a ? a.data : null;
  } catch { return null; }
}

async function resolveHost(host) {
  return (await lookupSystem(host)) || (await lookupTencent(host)) || (await lookupAli(host)) || null;
}

// ── 必应搜索（IP 直连 + TLS SNI）──
async function searchWeb(query) {
  const hostname = 'www.bing.com';
  const ip = await resolveHost(hostname);
  if (!ip) { console.log('[web-search] DNS 解析失败（系统网络异常），跳过搜索'); return []; }
  try {
    const path = `/search?q=${encodeURIComponent(String(query).trim())}&mkt=zh-CN&setlang=zh-hans`;
    const headers = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' };
    const { status, body } = await getText(ip, path, headers, hostname, true);
    if (status !== 200) return [];
    return parseBingHtml(body);
  } catch (e) {
    console.log('[web-search] 搜索失败(忽略，走正常问答):', e.message);
    return [];
  }
}

// 搜索结果 → 注入文本（供 AI 上下文使用；附当前日期，引导模型优先采纳最新信息）
function formatSearchResults(results) {
  if (!results || !results.length) return '';
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}${r.snippet ? '：' + r.snippet : ''}${r.url ? '（' + r.url + '）' : ''}`);
  return [
    `[联网搜索结果]（今天是${dateStr}，以下是刚刚搜索到的当前信息）`,
    ...lines,
    '[注意：以上为最新搜索结果。回答用户问题时，凡涉及现任/当前/最新/现在/今年等时效性内容，请优先依据搜索结果而不是你的训练记忆；用猫姬风格简短回答（20~60字，带【情绪】标记）；若搜索结果与问题无关，忽略它们直接正常回答即可]',
  ].join('\n');
}

module.exports = { searchWeb, formatSearchResults, resolveHost };
