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
  function recent(db, team, asOf, N) {
    const idx = db.by[team] || [], out = []; for (let j = idx.length - 1; j >= 0 && out.length < N; j--) { const r = db.R[idx[j]]; if (asOf && r.d >= asOf) continue; out.push(r); } return out;
  }
  /* 回傳每個市場的兩邊估計機率與推薦 */
  function analyze(db, m, asOf) {
    const sim = similar(db, m, asOf), simSp = db.R.filter(r => (!asOf || r.d < asOf) && Math.abs(r.sp - m.sp) <= TOL_SP);
    const ra = recent(db, m.aw, asOf, 15), rh = recent(db, m.hm, asOf, 15);
    const atsOf = (team, list) => cnt(list, r => { const o = outcome(r); if (o.aCover == null) return null; return r.aw === team ? o.aCover : !o.aCover; });
    const ovOf = list => cnt(list, r => outcome(r).over);
    // ---- 讓分:p(客蓋) ----
    const S = cnt(sim, r => outcome(r).aCover), S2 = cnt(simSp, r => outcome(r).aCover);
    const pS = shrink(S.k, S.n, 0.5, 30);
    const tA = atsOf(m.aw, ra), tH = atsOf(m.hm, rh);
    const pTeam = (shrink(tA.k, tA.n, 0.5, 15) + (1 - shrink(tH.k, tH.n, 0.5, 15))) / 2;
    const pAcover = 0.5 + ((pS - 0.5) + (pTeam - 0.5) * 0.5);
    // ---- 大小:p(大) ----
    const O = cnt(sim, r => outcome(r).over), O2 = cnt(simSp.filter(r => Math.abs(r.tot - m.tot) <= TOL_TOT), r => outcome(r).over);
    const oA = ovOf(ra), oH = ovOf(rh);
    const pO = shrink(O.k, O.n, 0.5, 30), pOteam = (shrink(oA.k, oA.n, 0.5, 15) + shrink(oH.k, oH.n, 0.5, 15)) / 2;
    const pOver = 0.5 + ((pO - 0.5) + (pOteam - 0.5) * 0.5);
    // ---- 不讓分:p(客勝),先驗=去水位後的市場機率 ----
    const [pmA] = devig2(m.mlA, m.mlH);
    const W = cnt(simSp, r => outcome(r).aWin), pW = shrink(W.k, W.n, pmA, 40);
    const clamp = x => Math.max(0.05, Math.min(0.95, x));
    const mk = (market, aKey, hKey, pA, oA_, oH_, n, extra) => {
      const sA = { market, key: aKey, p: clamp(pA), odds: oA_ }, sH = { market, key: hKey, p: clamp(1 - pA), odds: oH_ };
      [sA, sH].forEach(c => { c.val = c.p * c.odds; });
      const best = sA.p >= sH.p ? sA : sH; return Object.assign({ market, A: sA, H: sH, best, n }, extra || {});
    };
    return {
      sim: { n: sim.length, sp: S, tot: O, ml: W },
      spread: mk('讓分', 'AS', 'HS', pAcover, m.spAo, m.spHo, S.n, { team: { a: tA, h: tH } }),
      total: mk('大小', 'O', 'U', pOver, m.ov, m.un, O.n, { team: { a: oA, h: oH } }),
      ml: mk('不讓分', 'AM', 'HM', pW, m.mlA, m.mlH, W.n),
      pmA
    };
  }
  /* 結果判斷:key ∈ AS HS O U AM HM;回傳 true/false/null(平手退本金) */
  function judge(key, r) {
    const o = outcome(r);
    switch (key) { case 'AS': return o.aCover; case 'HS': return o.aCover == null ? null : !o.aCover; case 'O': return o.over; case 'U': return o.over == null ? null : !o.over; case 'AM': return o.aWin; case 'HM': return !o.aWin; }
    return null;
  }
  const api = { load, analyze, judge, outcome, shrink, similar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NBA = api;
})(typeof self !== 'undefined' ? self : this);
