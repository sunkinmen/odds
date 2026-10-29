/* NBA 分析模組(瀏覽器/Node 共用)。資料列:{d:'YYYYMMDD',ga,gh(客/主得分),sp(客讓分線),spA,spH(客/主讓分賠率),mlA,mlH,tot,ov,un,aw,hm(隊名)}
 * 三個市場:讓分(客/主)、大小總分、不讓分。證據來源:①相近盤口的歷史結果 ②兩隊本季近況(對盤/大小傾向)。
 * 誠實前提:運彩賠率約 1.7(讓分/大小),打平線約 59%;市場很有效率,多數規則回測不會賺。 */
(function (root) {
  const shrink = (k, n, p0, s) => { s = s == null ? 20 : s; const a = k + s * p0, b = n - k + s * (1 - p0); return a / (a + b); };
  function devig2(a, b) { const x = 1 / a, y = 1 / b, s = x + y; return [x / s, y / s]; }
  /* 盤口容許差:讓分線 ±1(盤口小時 ±0.5~1),總分 ±4 */
  const TOL_SP = 1.0, TOL_TOT = 4.0;
  function load(rows) {
    const R = rows.filter(r => r.ga != null && r.gh != null && r.sp != null && r.tot != null).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t || '') < (b.t || '') ? -1 : 1);
    const by = {}; R.forEach((r, i) => { r.i = i; (by[r.aw] = by[r.aw] || []).push(i); (by[r.hm] = by[r.hm] || []).push(i); });
    return { R, by };
  }
  /* 單場結果:讓分(客蓋盤?)、大小(大?)、不讓分(客勝?);push 回傳 null */
  function outcome(r) {
    const mA = r.ga - r.gh, t = r.ga + r.gh, c = mA + r.sp;      // 客讓分線 sp(客 -7.5 → 客要贏 8 分以上才蓋):客分差 + sp > 0 蓋盤
    return { aCover: c === 0 ? null : c > 0, over: t === r.tot ? null : t > r.tot, aWin: mA > 0 };
  }
  const cnt = (list, f) => { let k = 0, n = 0; list.forEach(r => { const v = f(r); if (v == null) return; n++; if (v) k++; }); return { k, n }; };
  function similar(db, m, asOf) {
    const out = []; for (let i = 0; i < db.R.length; i++) { const r = db.R[i]; if (asOf && r.d >= asOf) break; if (Math.abs(r.sp - m.sp) <= TOL_SP && Math.abs(r.tot - m.tot) <= TOL_TOT) out.push(r); } return out;
  }
  const wdOf = d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).getUTCDay();
  const minOf = t => { t = String(t || '').replace(':', ''); return t.length >= 3 ? +t.slice(0, -2) * 60 + +t.slice(-2) : null; };
  /* 一組歷史場次的統計:客蓋盤、大分、客勝、平均總分/盤口總分 */
  function stat(list) {
    const s = { n: list.length, ak: 0, an: 0, ok: 0, on: 0, wk: 0, tot: 0, line: 0 };
    list.forEach(r => { const o = outcome(r); if (o.aCover != null) { s.an++; if (o.aCover) s.ak++; } if (o.over != null) { s.on++; if (o.over) s.ok++; } if (o.aWin) s.wk++; s.tot += r.ga + r.gh; s.line += r.tot; });
    s.avgTot = s.n ? s.tot / s.n : null; s.avgLine = s.n ? s.line / s.n : null; return s;
  }
  const before = (r, asOf) => !asOf || r.d < asOf;
  /* 四組比對:①主隊主場相近盤口 ②客隊客場相近盤口 ③聯盟相近盤口組合 ④同星期、開賽時間相近 */
  function layers(db, m, asOf) {
    const own = (team, side) => (db.by[team] || []).map(i => db.R[i]).filter(r => r[side] === team && before(r, asOf));
    const near = list => list.filter(r => Math.abs(r.sp - m.sp) <= TOL_SP_T).sort((a, b) => a.d < b.d ? 1 : -1);
    const nearT = list => list.filter(r => Math.abs(r.tot - m.tot) <= TOL_TOT_T).sort((a, b) => a.d < b.d ? 1 : -1);
    const hmAll = own(m.hm, 'hm'), awAll = own(m.aw, 'aw');
    const L = {
      home: { sp: near(hmAll), tot: nearT(hmAll) }, away: { sp: near(awAll), tot: nearT(awAll) },
      lg: similar(db, m, asOf).sort((a, b) => a.d < b.d ? 1 : -1)
    };
    const wd = m.d ? wdOf(m.d) : null, mm = minOf(m.t);
    L.slot = (wd == null || mm == null) ? [] : db.R.filter(r => before(r, asOf) && wdOf(r.d) === wd && minOf(r.t) != null && Math.abs(minOf(r.t) - mm) <= 90 && Math.abs(r.sp - m.sp) <= 4).sort((a, b) => a.d < b.d ? 1 : -1);
    L.wd = wd; return L;
  }
  const TOL_SP_T = 2.0, TOL_TOT_T = 6.0;
  /* 回傳每個市場的兩邊估計機率與推薦 */
  function analyze(db, m, asOf) {
    const L = layers(db, m, asOf);
    const st = { home: { sp: stat(L.home.sp), tot: stat(L.home.tot) }, away: { sp: stat(L.away.sp), tot: stat(L.away.tot) }, lg: stat(L.lg), slot: stat(L.slot) };
    const wavg = arr => { let s = 0, w = 0; arr.forEach(([p, x]) => { s += p * x; w += x; }); return s / w; };
    // 讓分 p(客蓋):主隊主場蓋盤率低 → 客蓋機率高
    const pAcover = wavg([[1 - shrink(st.home.sp.an - st.home.sp.ak, st.home.sp.an, 0.5, 10), 1], [shrink(st.away.sp.ak, st.away.sp.an, 0.5, 10), 1], [shrink(st.lg.ak, st.lg.an, 0.5, 30), 1], [shrink(st.slot.ak, st.slot.an, 0.5, 30), 0.5]]);
    // 大小 p(大)
    const pOver = wavg([[shrink(st.home.tot.ok, st.home.tot.on, 0.5, 10), 1], [shrink(st.away.tot.ok, st.away.tot.on, 0.5, 10), 1], [shrink(st.lg.ok, st.lg.on, 0.5, 30), 1], [shrink(st.slot.ok, st.slot.on, 0.5, 30), 0.5]]);
    // 不讓分 p(客勝):先驗=去水位後的市場機率
    const pmA = m.mlA && m.mlH ? devig2(m.mlA, m.mlH)[0] : 0.5;
    const pW = wavg([[shrink(st.lg.wk, st.lg.n, pmA, 40), 1], [1 - shrink(st.home.sp.n - st.home.sp.wk, st.home.sp.n, 1 - pmA, 15), 1], [shrink(st.away.sp.wk, st.away.sp.n, pmA, 15), 1]]);
    const clamp = x => Math.max(0.05, Math.min(0.95, x));
    const mk = (market, aKey, hKey, pA, oA_, oH_, n) => {
      const sA = { market, key: aKey, p: clamp(pA), odds: oA_ }, sH = { market, key: hKey, p: clamp(1 - pA), odds: oH_ };
      [sA, sH].forEach(c => { c.val = c.p * c.odds; });
      const best = sA.p >= sH.p ? sA : sH; return { market, A: sA, H: sH, best, n };
    };
    return {
      L, st, sim: { n: L.lg.length },
      spread: mk('讓分', 'AS', 'HS', pAcover, m.spAo, m.spHo, st.lg.an),
      total: mk('大小', 'O', 'U', pOver, m.ov, m.un, st.lg.on),
      ml: mk('不讓分', 'AM', 'HM', pW, m.mlA, m.mlH, st.lg.n),
      pmA
    };
  }
  /* 結果判斷:key ∈ AS HS O U AM HM;回傳 true/false/null(平手退本金) */
  function judge(key, r) {
    const o = outcome(r);
    switch (key) { case 'AS': return o.aCover; case 'HS': return o.aCover == null ? null : !o.aCover; case 'O': return o.over; case 'U': return o.over == null ? null : !o.over; case 'AM': return o.aWin; case 'HM': return !o.aWin; }
    return null;
  }
  const api = { load, analyze, judge, outcome, shrink, similar, stat, wdOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NBA = api;
})(typeof self !== 'undefined' ? self : this);
