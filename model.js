/* 統計模型模組 (瀏覽器 / Node 共用):市場隱含進球模型(泊松+Dixon-Coles 修正)、貝氏收縮、分數凱利、串關與資金曲線模擬
 * 全部是純函式。誠實前提:運彩抽水約 23%,模型不保證優勢,凱利在期望值為負時會建議 0。 */
(function (root) {
  const G = 9;                                           // 單隊進球上限 0..8
  const RHO = -0.05;                                     // Dixon-Coles 低比分相依係數(由歷史資料估計,見 estimateRho 回測)
  const fct = [1]; for (let i = 1; i < 20; i++) fct[i] = fct[i - 1] * i;
  const pois = (l, k) => Math.exp(-l + k * Math.log(l) - Math.log(fct[k]));

  /* 去水位:power 法(自動修正「熱門被低估、冷門被高估」的偏誤),回傳機率陣列 */
  function devig(odds) {
    const inv = odds.map(o => 1 / o), s = inv.reduce((a, b) => a + b, 0);
    if (s <= 1) return inv.map(x => x / s);
    let lo = 1, hi = 3;
    for (let it = 0; it < 50; it++) { const k = (lo + hi) / 2, t = inv.reduce((a, x) => a + Math.pow(x, k), 0); if (t > 1) lo = k; else hi = k; }
    const k = (lo + hi) / 2, p = inv.map(x => Math.pow(x, k)), z = p.reduce((a, b) => a + b, 0);
    return p.map(x => x / z);
  }
  const overround = odds => odds.reduce((a, o) => a + 1 / o, 0) - 1;

  /* 比分矩陣 M[h][a],含 Dixon-Coles 修正並正規化 */
  function matrix(lh, la, rho) {
    rho = rho == null ? RHO : rho;
    const M = []; let z = 0;
    for (let h = 0; h < G; h++) { M[h] = []; for (let a = 0; a < G; a++) {
      let t = 1;
      if (h === 0 && a === 0) t = 1 - lh * la * rho; else if (h === 0 && a === 1) t = 1 + lh * rho; else if (h === 1 && a === 0) t = 1 + la * rho; else if (h === 1 && a === 1) t = 1 - rho;
      const v = Math.max(0, pois(lh, h) * pois(la, a) * t); M[h][a] = v; z += v;
    } }
    for (let h = 0; h < G; h++) for (let a = 0; a < G; a++) M[h][a] /= z;
    return M;
  }
  function summarize(M) {
    let pH = 0, pD = 0, pA = 0, pU = 0;
    for (let h = 0; h < G; h++) for (let a = 0; a < G; a++) { const v = M[h][a]; if (h > a) pH += v; else if (h === a) pD += v; else pA += v; if (h + a <= 2) pU += v; }
    return { pH, pD, pA, pU };
  }
  /* 由市場機率反推兩隊預期進球 (lh, la):座標搜尋最小化平方誤差 */
  function fit(pH, pD, pA, pU, rho) {
    const loss = (lh, la) => { const s = summarize(matrix(lh, la, rho)); let e = (s.pH - pH) ** 2 + (s.pD - pD) ** 2 + (s.pA - pA) ** 2; if (pU != null) e += (s.pU - pU) ** 2; return e + 0.0005 * (lh + la - 2.7) ** 2; };
    let lh = 1.4, la = 1.1, step = 0.4, best = loss(lh, la);
    for (let it = 0; it < 80 && step > 1e-3; it++) {
      let moved = false;
      for (const [dh, da] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const h2 = Math.max(0.05, lh + dh * step), a2 = Math.max(0.05, la + da * step), e = loss(h2, a2);
        if (e < best) { best = e; lh = h2; la = a2; moved = true; }
      }
      if (!moved) step *= 0.5;
    }
    return { lh, la, err: best };
  }
  /* 由賠率(主/和/客 + 可選的小分機率)直接得到比分模型 */
  function scoreModel(oh, od, oa, pU, rho) {
    const p = devig([oh, od, oa]), f = fit(p[0], p[1], p[2], pU == null ? null : pU, rho);
    const M = matrix(f.lh, f.la, rho), s = summarize(M);
    return { lh: f.lh, la: f.la, M, p: [s.pH, s.pD, s.pA], pU: s.pU, err: f.err };
  }

  /* 把「模型比分分布(先驗)」與多組歷史比分次數(證據)貝氏合併。
     srcs: [{ n, counts: {'a:h': cnt}, w }];alpha = 先驗等效場數;每組證據最多算 cap 場,避免單一來源壓過模型。 */
  function blendScores(M, srcs, opt) {
    opt = Object.assign({ alpha: 12, cap: 25 }, opt || {});
    const acc = {}; let tot = opt.alpha;
    for (let h = 0; h < G; h++) for (let a = 0; a < G; a++) acc[a + ':' + h] = opt.alpha * M[h][a];
    (srcs || []).forEach(s => {
      if (!s || !s.n) return; const k = (s.w == null ? 1 : s.w) * Math.min(1, opt.cap / s.n);
      Object.keys(s.counts).forEach(key => { acc[key] = (acc[key] || 0) + k * s.counts[key]; }); tot += k * s.n;
    });
    return Object.keys(acc).map(key => { const [a, h] = key.split(':').map(Number); return { a, h, p: acc[key] / tot }; }).sort((x, y) => y.p - x.p);
  }
  const modelTop = (M, n) => { const o = []; for (let h = 0; h < G; h++) for (let a = 0; a < G; a++) o.push({ a, h, p: M[h][a] }); return o.sort((x, y) => y.p - x.p).slice(0, n || 3); };

  /* ---- 貝氏收縮:小樣本的「100%」不可信 ----
     k/n 向先驗機率 p0 收縮,先驗強度 s 場。3/3 且 p0=0.5、s=8 → 8/11... 回傳收縮後機率與 80% 信賴下界(Beta 近似) */
  function shrink(k, n, p0, s) {
    s = s == null ? 8 : s; const a = k + s * p0, b = n - k + s * (1 - p0), m = a / (a + b), v = a * b / ((a + b) ** 2 * (a + b + 1));
    return { p: m, lo: Math.max(0, m - 1.2816 * Math.sqrt(v)), hi: Math.min(1, m + 1.2816 * Math.sqrt(v)) };
  }

  /* ---- 資金管理 ---- */
  /* 分數凱利:f* = (p*o-1)/(o-1);frac=縮小倍數(預設 1/4);pSd=機率不確定度(以 p-pSd 計算,保守);cap=單注上限占資金比例 */
  function kelly(p, odds, o) {
    o = Object.assign({ frac: 0.25, cap: 0.05, pSd: 0 }, o || {});
    const pp = Math.max(0, p - o.pSd), f = (pp * odds - 1) / (odds - 1);
    return f > 0 ? Math.min(o.cap, f * o.frac) : 0;
  }
  /* 串關:各腿獨立假設(不同場次相關性很小),總賠率=相乘;回傳機率、期望報酬、有效抽水 */
  function parlay(legs) {
    const odds = legs.reduce((t, l) => t * l.odds, 1), p = legs.reduce((t, l) => t * l.p, 1), fair = legs.reduce((t, l) => t * (l.pm != null ? l.pm : l.p), 1);
    return { odds, p, ev: p * odds - 1, margin: 1 - fair * odds };   // margin:市場公平機率下的期望虧損比例
  }
  /* 蒙地卡羅資金曲線:bets=[{p,odds,stake(占資金比例)}] 每輪依序下注;rounds 輪、sims 次 */
  function simulate(bets, rounds, sims, seed) {
    let s = seed || 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const end = [], dd = []; let ruin = 0;
    for (let i = 0; i < sims; i++) {
      let B = 1;
      for (let r = 0; r < rounds && B > 0.02; r++) bets.forEach(b => { const st = B * b.stake; B -= st; if (rnd() < b.p) B += st * b.odds; });
      end.push(B); if (B <= 0.5) ruin++;
    }
    end.sort((a, b) => a - b); const q = x => end[Math.min(end.length - 1, Math.floor(x * end.length))];
    return { median: q(0.5), p10: q(0.1), p90: q(0.9), pHalf: ruin / sims, pUp: end.filter(x => x > 1).length / sims };
  }
  const api = { G, RHO, devig, overround, matrix, summarize, fit, scoreModel, blendScores, modelTop, shrink, kelly, parlay, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHM = api;
})(typeof self !== 'undefined' ? self : this);
