// Cloudflare Worker: 讓 PWA 能跨網域抓運彩的公開 JSON (CORS 轉送)。只允許 sportslottery.com.tw。
export default {
  async fetch(req) {
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const u = new URL(req.url).searchParams.get('url');
    let t; try { t = new URL(u); } catch { return new Response('bad url', { status: 400, headers: h }); }
    if (t.protocol !== 'https:' || !/(^|\.)sportslottery\.com\.tw$/.test(t.hostname)) return new Response('host not allowed', { status: 403, headers: h });
    const r = await fetch(t.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,*/*' }, cf: { cacheTtl: 30 } });
    return new Response(r.body, { status: r.status, headers: { ...h, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  }
};
