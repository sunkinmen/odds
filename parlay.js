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
  const api = { recommend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHP = api;
})(typeof self !== 'undefined' ? self : this);
