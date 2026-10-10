// 抖音图文链接解析：短链重定向 → 页面抓取 → 提取图文标题/描述/图片
const fs = require('fs');
const path = require('path');

async function main() {
  const short = 'https://v.douyin.com/fEEhGwdrn2c/';
  // 1. 短链重定向拿真实页面 URL
  let finalUrl = short;
  try {
    const r = await fetch(short, { redirect: 'follow', headers: { 'User-Agent': UA() } });
    finalUrl = r.url || short;
    console.log('STATUS:', r.status);
    console.log('FINAL_URL:', finalUrl);
    const html = await r.text();
    fs.writeFileSync(path.join(__dirname, 'douyin_page.html'), html, 'utf8');
    console.log('HTML_BYTES:', Buffer.byteLength(html));
    // 提取标题
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    console.log('TITLE:', t ? t[1] : '(无)');
    // 找描述/文案
    const desc = html.match(/"desc"\s*:\s*"([^"]{5,300})"/);
    console.log('DESC:', desc ? desc[1] : '(无)');
    // 找图文图片数量线索
    const imgs = html.match(/"images"\s*:\s*\[([^\]]*)\]/g);
    console.log('IMAGES_BLOCKS:', imgs ? imgs.length : 0);
  } catch (e) {
    console.log('FETCH_ERR:', e.message);
    try {
      const r2 = await fetch(short, { redirect: 'manual' });
      console.log('MANUAL_STATUS:', r2.status, 'LOCATION:', r2.headers.get('location'));
    } catch (e2) { console.log('MANUAL_ERR:', e2.message); }
  }
}
function UA() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}
main();
