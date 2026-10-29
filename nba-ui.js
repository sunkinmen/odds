/* NBA 版介面:頂部一鍵切換 足球 / NBA。資料:data/nba_raw.json(歷史)+ data/nba_live.json(今天前後的賽事與賽果,由 GitHub Actions 每 20 分鐘自動更新) */
(function () {
  const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const MIN_ODDS = 1.6, WD = ['日', '一', '二', '三', '四', '五', '六'];
  let sport = ls.get('oh_sport', 'fb'), db = null, live = null, games = [], analyses = new Map(), activeDay = 0, sortMode = ls.get('oh_nsort', 'best'), fbStat = '', openId = null, loading = false;
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const addDay = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
  const pct = x => Math.round(x * 100) + '%';
  const fmtLine = x => (x > 0 ? '+' : '') + x;

  const css = document.createElement('style');
  css.textContent = `
.sw{margin-left:auto;display:inline-flex;background:var(--paper);border:1px solid var(--line);border-radius:99px;padding:3px;box-shadow:var(--shadow)}
.sw button{white-space:nowrap;border:0;background:transparent;color:var(--mute);font:inherit;font-size:13px;font-weight:700;padding:5px 13px;border-radius:99px;letter-spacing:.04em}
.sw button.on{background:var(--deep);color:#f3efe9}
#nbaDays{display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
body.nba #nbaDays{display:grid}
body.nba #days,body.nba #nav [data-t=parlay],body.nba #nav [data-t=ai]{display:none!important}
body.nba #tab-matches > *:not(#nbaView){display:none!important}
#nbaView{display:none}body.nba #nbaView{display:block}
.nrow{display:grid;grid-template-columns:42px 1fr 1fr;gap:6px;align-items:stretch;margin:5px 0}
.nrow>em{font-style:normal;font-size:12px;color:var(--mute);align-self:center;font-weight:700}
.nb{border:1px solid var(--line);border-radius:12px;padding:6px 8px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;background:var(--paper)}
.nb i{display:block;font-style:normal;font-size:11px;color:var(--mute);font-weight:600}
.nb.alt{border:2px dashed var(--sage)}
.nb.pick{background:var(--deep);border-color:var(--deep);color:#f3efe9}.nb.pick i{color:#d3dcd3}
.nb small{display:block;font-weight:500;font-size:10.5px;opacity:.8}
#nbaView .match .det p{margin:6px 0;font-size:13px}
`;
  document.head.appendChild(css);

  /* ---------- 版面 ---------- */
  const brand = document.querySelector('.brand');
  const sw = document.createElement('div'); sw.className = 'sw'; sw.innerHTML = '<button type="button" data-s="fb">足球</button><button type="button" data-s="nba">NBA</button>';
  if (brand) brand.appendChild(sw);
  const top = document.querySelector('.top'); const nd = document.createElement('div'); nd.id = 'nbaDays'; if (top) top.appendChild(nd);
  const main = $('tab-matches'); const view = document.createElement('div'); view.id = 'nbaView';
  view.innerHTML = '<div class="row" style="margin-top:2px"><button class="btn sm" id="nbRefresh">更新賽事</button><span class="hint grow" id="nbMsg" style="margin:0"></span></div><div class="sortbar"><span>排序</span><button data-m="best">最佳</button><button data-m="time">時間</button></div><div id="nbaList"></div>';
  if (main) main.appendChild(view);

  function paintSwitch() { sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === sport)); document.body.classList.toggle('nba', sport === 'nba'); }
  sw.onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.s === sport) return; setSport(b.dataset.s); };
  function setSport(s) {
    const st = $('dbstat');
    if (s === 'nba' && sport !== 'nba' && st) fbStat = st.textContent;
    sport = s; ls.set('oh_sport', s); paintSwitch();
    if (s === 'nba') { const t = document.querySelector('#nav [data-t=matches]'); if (t) t.click(); init(); } else if (st && fbStat) st.textContent = fbStat;
  }

  /* ---------- 資料 ---------- */
  async function loadAll(force) {
    const opt = { cache: 'no-cache' };
    if (!db) {
      const raw = await (await fetch('data/nba_raw.json', opt)).json();
      const rows = raw.lines.map(l => { const p = l.split(','); return { d: '20' + p[0], t: p[1], aw: raw.T[+p[2]], hm: raw.T[+p[3]], ga: +p[4], gh: +p[5], sp: +p[6], spAo: +p[7], spHo: +p[8], mlA: p[9] === '' ? null : +p[9], mlH: p[10] === '' ? null : +p[10], tot: +p[11], ov: +p[12], un: +p[13] }; });
      db = NBA.load(rows);
    }
    try { const r = await fetch('data/nba_live.json', opt); live = r.ok ? await r.json() : null; } catch (e) { live = null; }
    games = live && live.games ? live.games : [];
  }
  function analyzeAll() {
    analyses.clear();
    games.forEach(g => {
      if (g.sp == null || g.tot == null) return;
      const m = { aw: g.aw, hm: g.hm, sp: g.sp, spAo: g.spAo, spHo: g.spHo, mlA: g.mlA, mlH: g.mlH, tot: g.tot, ov: g.ov, un: g.un };
      try {
        const a = NBA.analyze(db, m, g.d.replace(/-/g, '').slice(0, 8));
        const cands = [a.spread.best, a.total.best].concat(g.mlA && g.mlH ? [a.ml.best] : []).filter(c => c.odds >= MIN_ODDS);
        cands.sort((x, y) => y.val - x.val);
        analyses.set(g.id, { a, best: cands[0] || null, alt: cands[1] || null });
      } catch (e) { console.warn(e); }
    });
  }
  const dayList = () => { const t = today(); return [addDay(t, -1), t, addDay(t, 1)]; };

  /* ---------- 呈現 ---------- */
  const LBL = { AS: '客讓分', HS: '主讓分', O: '大分', U: '小分', AM: '客不讓分', HM: '主不讓分' };
  const keyText = (c, g) => c.key === 'AS' ? `客 ${fmtLine(g.sp)}` : c.key === 'HS' ? `主 ${fmtLine(-g.sp)}` : c.key === 'O' ? `大 ${g.tot}` : c.key === 'U' ? `小 ${g.tot}` : c.key === 'AM' ? '客不讓分' : '主不讓分';
  function row(label, A, H, best, alt, g) {
    const box = (c, top, sub) => `<div class="nb${best && best.key === c.key ? ' pick' : alt && alt.key === c.key ? ' alt' : ''}"><i>${top}</i>${c.odds}<small>${pct(c.p)}</small></div>`;
    return `<div class="nrow"><em>${label}</em>${box(A, label === '讓分' ? `客 ${fmtLine(g.sp)}` : label === '大小' ? `大 ${g.tot}` : '客')}${box(H, label === '讓分' ? `主 ${fmtLine(-g.sp)}` : label === '大小' ? `小 ${g.tot}` : '主')}</div>`;
  }
  function badge(g, c) {
    if (!g.sc) return '';
    const r = { ga: g.sc[0], gh: g.sc[1], sp: g.sp, tot: g.tot }, sc = `<small>${g.sc[0]}:${g.sc[1]}</small>`;
    const w = c ? NBA.judge(c.key, r) : null;
    if (w === true) return `<span class="rb win">✨ 贏 ${sc}</span>`;
    if (w === false) return `<span class="rb lose">輸 ${sc}</span>`;
    return `<span class="rb none">${w === null && c ? '平手 ' : '完賽 '}${sc}</span>`;
  }
  function detail(g, an) {
    const a = an.a, S = a.sim;
    const rate = (o) => o.n ? `${o.k}/${o.n}(${pct(o.k / o.n)})` : '—';
    const tm = (o) => o.n ? `${o.k}/${o.n}` : '—';
    return `<div class="det"><p><b>相近盤口</b>(讓分 ±1、總分 ±4)歷史 ${S.n} 場</p>
<p>讓分:客隊蓋盤 ${rate(S.sp)}・近 15 場對盤 客隊 ${tm(a.spread.team.a)}、主隊 ${tm(a.spread.team.h)}</p>
<p>大小:大分 ${rate(S.tot)}・近 15 場大分 客隊 ${tm(a.total.team.a)}、主隊 ${tm(a.total.team.h)}</p>
<p>不讓分:客勝 ${rate(S.ml)}</p>
<details class="note"><summary>ⓘ</summary><div class="hint">百分比是歷史相近盤口加兩隊近況的估計機率(已向 50% 收縮)。運彩賠率約 1.7,要命中 59% 以上才不虧;回測顯示三個市場平均都還是虧(大小分 −8%、不讓分 −14%、讓分 −16%)。</div></details></div>`;
  }
  function card(g, medal) {
    const an = analyses.get(g.id); let verdict = '', body = '';
    if (an) {
      const a = an.a, b = an.best;
      body = row('讓分', a.spread.A, a.spread.H, b, an.alt, g) + row('大小', a.total.O || a.total.A, a.total.U || a.total.H, b, an.alt, g) + (g.mlA && g.mlH ? row('不讓分', a.ml.A, a.ml.H, b, an.alt, g) : '');
      verdict = b ? `<span class="tag">建議 ${keyText(b, g)} @${b.odds}</span>${an.alt ? `<span class="tag plain">另 ${keyText(an.alt, g)} @${an.alt.odds}</span>` : ''}<span class="tag plain">相近盤口 ${a.sim.n} 場</span>` : '<span class="tag skip">賠率偏低,不推薦</span>';
    } else body = '<div class="hint">缺少盤口資料</div>';
    const MED = [['gold', '金牌'], ['silver', '銀牌'], ['bronze', '銅牌']];
    return `<article class="match${an && an.best ? ' pick' : ''}${medal != null ? ' medal ' + MED[medal][0] : ''}${openId === g.id ? ' open' : ''}" data-id="${esc(g.id)}">${badge(g, an && an.best)}${medal != null ? `<span class="mbadge">${MED[medal][1]} · 今日第 ${medal + 1} 名</span>` : ''}
<div class="mt"><b>${esc(g.time)}</b><span>NBA</span></div>
<div><div class="teams">${esc(g.aw)}<span class="at">@</span>${esc(g.hm)}</div>${body}<div class="verdict">${verdict}</div></div>${an ? detail(g, an) : ''}</article>`;
  }
  function render() {
    if (sport !== 'nba') return;
    const ds = dayList(), d = ds[activeDay], st = $('dbstat');
    if (st && db) st.textContent = `NBA ${db.R.length.toLocaleString()} 場歷史資料 · 2025 球季起`;
    const cnt = x => games.filter(g => g.d === x).length;
    nd.innerHTML = ds.map((x, i) => `<button class="day ${activeDay === i ? 'on' : ''}" data-i="${i}"><b>${['昨天', '今天', '明天'][i]}<em class="cnt">${cnt(x)} 場</em></b><span>${x.slice(5).replace('-', '/')} 週${WD[new Date(x + 'T00:00:00Z').getUTCDay()]}</span></button>`).join('');
    view.querySelectorAll('.sortbar button').forEach(b => b.classList.toggle('on', b.dataset.m === sortMode));
    let list = games.filter(g => g.d === d).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    let ranks = new Map();
    if (sortMode === 'best') {
      const ranked = list.filter(g => analyses.get(g.id) && analyses.get(g.id).best && !g.sc).sort((x, y) => analyses.get(y.id).best.val - analyses.get(x.id).best.val);
      ranked.forEach((g, i) => ranks.set(g.id, i));
      list = ranked.concat(list.filter(g => !ranks.has(g.id)));
    }
    $('nbaList').innerHTML = list.length ? list.map(g => card(g, ranks.has(g.id) && ranks.get(g.id) < 3 ? ranks.get(g.id) : null)).join('') : '<div class="empty"><div>這天沒有 NBA 賽事</div><div class="hint">賽事資料每 20 分鐘自動更新</div></div>';
    const upd = live && live.updated ? `更新 ${live.updated.slice(5, 16).replace('T', ' ')}` : '尚無即時賽事資料';
    $('nbMsg').textContent = upd;
  }
  nd.onclick = e => { const b = e.target.closest('.day'); if (!b) return; activeDay = +b.dataset.i; render(); };
  view.querySelector('.sortbar').onclick = e => { const b = e.target.closest('button'); if (!b) return; sortMode = b.dataset.m; ls.set('oh_nsort', sortMode); render(); };
  $('nbaList').onclick = e => { const c = e.target.closest('.match'); if (!c) return; openId = openId === c.dataset.id ? null : c.dataset.id; c.classList.toggle('open', openId === c.dataset.id); };
  async function init(force) {
    if (loading) return; loading = true; $('nbMsg').textContent = '載入中…';
    try { await loadAll(force); activeDay = 1; analyzeAll(); render(); } catch (e) { $('nbMsg').textContent = '載入失敗:' + e.message; }
    loading = false;
  }
  $('nbRefresh').onclick = async () => { loading = false; $('nbMsg').textContent = '更新中…'; try { await loadAll(true); analyzeAll(); render(); } catch (e) { $('nbMsg').textContent = '更新失敗:' + e.message; } };
  paintSwitch();
  try { const st0 = $('dbstat'); if (st0) new MutationObserver(() => { if (st0.textContent.indexOf('NBA') !== 0) fbStat = st0.textContent; if (sport === 'nba' && db && st0.textContent.indexOf('NBA') !== 0) st0.textContent = `NBA ${db.R.length.toLocaleString()} 場歷史資料 · 2025 球季起`; }).observe(st0, { childList: true, characterData: true, subtree: true }); } catch (e) { }
  if (sport === 'nba') init();
  window.NBAUI = { setSport };
})();
