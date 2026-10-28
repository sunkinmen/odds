// Cloudflare Worker:替 App 抓玩運彩足球頁(App 在瀏覽器裡不能直接跨網站讀取,需要這一層轉送)
// 用法: GET https://你的worker網址/?d=20261029  → 回傳該日 HTML(加上 CORS)
export default {
  async fetch(req) {
    const u = new URL(req.url), d = u.searchParams.get('d') || '';
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
    if (!/^\d{8}$/.test(d)) return new Response('bad d', { status: 400, headers: cors });
    const r = await fetch(`https://www.playsport.cc/predict/scale?allianceid=4&gametime=${d}&sid=0`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 'Accept-Language': 'zh-TW' },
      cf: { cacheTtl: 120, cacheEverything: true }
    });
    return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
  }
};
