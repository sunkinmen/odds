/* 串關組合推薦 (瀏覽器 / Node 共用)
 * legs: [{id, label, odds, p, minLeg}]  每場最多一個選項
 * 規則: 串數 k 必須 >= 所選各場的 minLeg 最大值; 每個選項賠率需 >= minOdds; 同場不重複
 */
(function (root) {
  function combos(arr, k, cb) {
    const idx = [];
    (function rec(start) {
      if (idx.length === k) { cb(idx.map(i => arr[i])); return; }
      for (let i = start; i < arr.length; i++) { idx.push(i); rec(i + 1); idx.pop(); }
    })(0);
  }
  function recommend(legs, o) {
    o = Object.assign({ minOdds: 1.3, minProb: 0.5, kMin: 2, kMax: 4, maxCand: 14, minJoint: 0.12, sortBy: 'ev', top: 6 }, o || {});
    const pool = legs.filter(l => l.odds >= o.minOdds && l.p >= o.minProb)
      .sort((a, b) => b.p - a.p).slice(0, o.maxCand);
    const out = [];
    for (let k = Math.max(2, o.kMin); k <= Math.min(o.kMax, 8, pool.length); k++) {
      combos(pool, k, c => {
        const need = Math.max(...c.map(x => x.minLeg || 1));
        if (k < need) return;
        const odds = c.reduce((s, x) => s * x.odds, 1);
        const p = c.reduce((s, x) => s * x.p, 1);
        if (p < o.minJoint) return;
        out.push({ k, legs: c, odds, p, ev: p * odds - 1, need });
      });
    }
    out.sort(o.sortBy === 'p' ? (a, b) => b.p - a.p : (a, b) => b.ev - a.ev);
    // 每場最多出現在 3 個推薦組合中,避免全部都是同一批
    const used = new Map(), res = [];
    for (const r of out) {
      if (r.legs.some(l => (used.get(l.id) || 0) >= 3)) continue;
      r.legs.forEach(l => used.set(l.id, (used.get(l.id) || 0) + 1));
      res.push(r); if (res.length >= o.top) break;
    }
    return { pool, picks: res, total: out.length };
  }

  /* ---- 系統串關 (N串M): 從 N 場中,依型態列出所有 j 場組合,每組各下一注 ---- */
  const SYS = {
    2: [['2串1', [2]]],
    3: [['3串1', [3]], ['3串3', [2]], ['3串4', [2, 3]]],
    4: [['4串1', [4]], ['4串4', [3]], ['4串5', [3, 4]], ['4串6', [2]], ['4串10', [2, 3]], ['4串11', [2, 3, 4]]],
    5: [['5串1', [5]], ['5串5', [4]], ['5串6', [4, 5]], ['5串10', [2]], ['5串15', [3, 4]], ['5串16', [3, 4, 5]], ['5串20', [2, 3]], ['5串26', [2, 3, 4, 5]]],
    6: [['6串1', [6]], ['6串6', [5]], ['6串7', [5, 6]], ['6串15', [2]], ['6串20', [3]], ['6串22', [4, 5, 6]], ['6串35', [2, 3]], ['6串42', [3, 4, 5, 6]], ['6串50', [2, 3, 4]], ['6串57', [2, 3, 4, 5, 6]]],
    7: [['7串1', [7]], ['7串7', [6]], ['7串8', [6, 7]], ['7串21', [2]], ['7串35', [3]], ['7串120', [2, 3, 4, 5, 6, 7]]],
    8: [['8串1', [8]], ['8串8', [7]], ['8串9', [7, 8]], ['8串28', [2]], ['8串56', [3]], ['8串70', [4]], ['8串247', [2, 3, 4, 5, 6, 7, 8]]]
  };
  function combosIdx(n, k) { const out = [], c = []; (function rec(s) { if (c.length === k) { out.push(c.slice()); return; } for (let i = s; i < n; i++) { c.push(i); rec(i + 1); c.pop(); } })(0); return out; }
  function calcSystem(legs, sizes, stake) {
    const n = legs.length; stake = stake || 100;
    // 組合規則:組合場數需 >= 組內各場「最低串數」,不合規的組合不計
    const all = []; sizes.forEach(k => combosIdx(n, k).forEach(ix => all.push(ix)));
    const combos = all.map(ix => {
      const need = Math.max(...ix.map(i => legs[i].minLeg || 1));
      return { ix, k: ix.length, need, ok: ix.length >= need, odds: ix.reduce((t, i) => t * legs[i].odds, 1), p: ix.reduce((t, i) => t * legs[i].p, 1) };
    });
    const valid = combos.filter(c => c.ok), bad = combos.length - valid.length;
    const bets = valid.length, cost = bets * stake;
    const maxRet = valid.reduce((t, c) => t + c.odds * stake, 0);
    const expRet = valid.reduce((t, c) => t + c.p * c.odds * stake, 0);
    let pBreak = 0, pAny = 0;                       // 由所有 2^n 種對錯結果精確算出(獨立假設)
    for (let mask = 0; mask < (1 << n); mask++) {
      let pr = 1; for (let i = 0; i < n; i++) pr *= (mask >> i & 1) ? legs[i].p : 1 - legs[i].p;
      let ret = 0; valid.forEach(c => { if (c.ix.every(i => mask >> i & 1)) ret += c.odds * stake; });
      if (ret > 0) pAny += pr; if (ret >= cost && cost > 0) pBreak += pr;
    }
    return { n, bets, bad, cost, maxRet, expRet, ev: cost ? expRet / cost - 1 : 0, pAny, pBreak, combos: valid };
  }
  const api = { recommend, SYS, calcSystem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHP = api;
})(typeof self !== 'undefined' ? self : this);
