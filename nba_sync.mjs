// 抓玩運彩 NBA 運彩盤(讓分/大小/不讓分)與賽果:今天前後各一天 → data/nba_live.json;已完賽且盤口齊全的場次追加進 data/nba_raw.json
import fs from 'node:fs';
import * as cheerio from 'cheerio';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const tp = d => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const addDay = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const t = tp(new Date()), days = [addDay(t, -1), t, addDay(t, 1)];
const tx = e => e.text().replace(/\s+/g, ' ').trim();
export function parse(html, d) {
  const $ = cheerio.load(html), g = {}, order = [];
  $('tr[gameid]').each((_, tr) => { const id = $(tr).attr('gameid'); if (!g[id]) { g[id] = []; order.push(id); } g[id].push($(tr)); });
  const out = [];
  order.forEach(id => {
    const [r1, r2] = g[id]; if (!r2) return;
    const gi = r1.find('.td-gameinfo'), ti = r1.find('.td-teaminfo'); if (!gi.length || !ti.length) return;
    const m = tx(gi.find('h4')).match(/([AP])M\s*(\d+):(\d+)/); const hh = m ? ((+m[2] === 12 ? 0 : +m[2]) + (m[1] === 'P' ? 12 : 0)) : 0;
    const time = String(hh).padStart(2, '0') + ':' + (m ? m[3] : '00');
    const lis = ti.find('.scores li').map((_, li) => tx($(li))).get().filter(s => /^\d+$/.test(s));
    const names = ti.find('a').map((_, a) => tx($(a))).get().filter(Boolean); if (names.length < 2) return;
    const cell = (r, c) => tx(r.find('.td-bank-' + c).first());
    const a = cell(r1, 'bet01').match(/(客|主)\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([\d.]+)/), h = cell(r2, 'bet01').match(/(客|主)\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([\d.]+)/);
    const t1 = cell(r1, 'bet02').match(/大\s*(\d+(?:\.\d+)?)\s*,\s*([\d.]+)/), t2 = cell(r2, 'bet02').match(/小\s*(\d+(?:\.\d+)?)\s*,\s*([\d.]+)/);
    const ml = (r, s) => { const x = cell(r, 'bet03').replace(s, '').match(/\d+(?:\.\d+)?/); return x ? +x[0] : null; };
    if (!a || !t1) return;
    out.push({ id, d, time, aw: names[0], hm: names[names.length - 1], sp: +a[2], spAo: +a[3], spHo: h ? +h[3] : null, mlA: ml(r1, '客'), mlH: ml(r2, '主'), tot: +t1[1], ov: +t1[2], un: t2 ? +t2[2] : null, sc: lis.length >= 2 ? [+lis[0], +lis[lis.length - 1]] : null });
  });
  return out;
}
async function main() {
  const games = []; let ok = 0;
  for (const d of days) {
    try {
      const r = await fetch(`https://www.playsport.cc/predict/scale?allianceid=3&gametime=${d.replace(/-/g, '')}&sid=0`, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      games.push(...parse(await r.text(), d)); ok++;
    } catch (e) { console.error(d, e.message); }
    await new Promise(s => setTimeout(s, 2500));
  }
  if (!ok) { console.error('全部失敗,保留舊資料'); return; }
  fs.mkdirSync('data', { recursive: true });
  const prev = fs.existsSync('data/nba_live.json') ? JSON.parse(fs.readFileSync('data/nba_live.json', 'utf8')) : { games: [] };
  const failed = days.filter(d => !games.some(g => g.d === d));
  const all = games.concat((prev.games || []).filter(g => failed.includes(g.d)));
  all.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : x.time < y.time ? -1 : 1);
  const now = new Date().toISOString().slice(0, 19);
  fs.writeFileSync('data/nba_live.json', JSON.stringify({ updated: now, games: all }));
  // 追加歷史
  if (fs.existsSync('data/nba_raw.json')) {
    const raw = JSON.parse(fs.readFileSync('data/nba_raw.json', 'utf8')), T = raw.T, have = new Set(raw.lines.map(l => { const p = l.split(','); return p[0] + '|' + p[2] + '|' + p[3]; }));
    const idx = n => { let i = T.indexOf(n); if (i < 0) { T.push(n); i = T.length - 1; } return i; };
    let add = 0;
    all.filter(g => g.sc && g.spHo != null && g.un != null).forEach(g => {
      const key = g.d.slice(2).replace(/-/g, '') + '|' + idx(g.aw) + '|' + idx(g.hm); if (have.has(key)) return; have.add(key);
      raw.lines.push([g.d.slice(2).replace(/-/g, ''), g.time.replace(':', ''), idx(g.aw), idx(g.hm), g.sc[0], g.sc[1], g.sp, g.spAo, g.spHo, g.mlA ?? '', g.mlH ?? '', g.tot, g.ov, g.un, g.id.slice(-3)].join(',')); add++;
    });
    if (add) fs.writeFileSync('data/nba_raw.json', JSON.stringify(raw));
    console.log('appended', add);
  }
  console.log('games', all.length);
}
if (process.argv[1] && process.argv[1].endsWith('nba_sync.mjs')) main();
