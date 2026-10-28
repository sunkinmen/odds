/* 賠率獵人 四層比對引擎 (瀏覽器 / Node 共用)
 * 視角約定:所有層的結果都換算成「強隊視角」: 0=強隊勝 1=和 2=強隊負
 * 強隊 = 主/客賠率較低的一方(平手取主隊)。
 */
(function (root) {
  const TOL1 = [0.04, 0.07, 0.10];   // L1/L4 球隊層容差(逐步放寬直到樣本數夠)
  const TOL2 = [0.04, 0.07, 0.10];   // L2 聯賽層
  const TOL3 = 0.12;                 // L3 同星期/時段層(誤差放大)
  const MIN_N = { L1: 8, L2: 30, L3: 5, L4: 8 };
  const TIME_WIN = 90;               // 分鐘
  // 小分(總進球<=2)的賠率→機率校準(由 6.4 萬場歷史資料擬合)
  const U_CAL = [[0.349, 0.279], [0.463, 0.38], [0.525, 0.444], [0.574, 0.501], [0.626, 0.55], [0.676, 0.599], [0.723, 0.648]];

  function interp(x, tbl) {
    if (x <= tbl[0][0]) return tbl[0][1] * x / tbl[0][0];
    for (let i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    const [x0, y0] = tbl[tbl.length - 2], [x1, y1] = tbl[tbl.length - 1];
    return Math.min(0.95, y1 + (y1 - y0) * (x - x1) / (x1 - x0));
  }
  const norm = s => String(s || '').replace(/[\s 　]+/g, '').toLowerCase();

  function load(data) {
    const n = data.n;
    const db = { n, teams: data.teams, leagues: data.leagues, d: data.d, w: Int8Array.from(data.w), t: Int16Array.from(data.t) };
    db.l = Int16Array.from(data.l); db.a = Int32Array.from(data.a); db.h = Int32Array.from(data.h);
    db.oh = Float32Array.from(data.oh, v => v / 100); db.od = Float32Array.from(data.od, v => v / 100); db.oa = Float32Array.from(data.oa, v => v / 100);
    db.ou = Float32Array.from(data.ou, v => v / 100);           // 0 = 無
    db.tot = Int8Array.from(data.ga, (v, i) => v + data.gh[i]);
    db.ga = Int8Array.from(data.ga); db.gh = Int8Array.from(data.gh);
    db.res = Int8Array.from(data.gh, (v, i) => v > data.ga[i] ? 0 : v === data.ga[i] ? 1 : 2); // 0主勝 1和 2客勝
    db.year = Int16Array.from(data.d, v => 2000 + Math.floor(v / 10000));
    const nameIdx = new Map(); data.teams.forEach((t, i) => nameIdx.set(norm(t), i)); db.nameIdx = nameIdx;
    const lgIdx = new Map(); data.leagues.forEach((t, i) => lgIdx.set(norm(t), i)); db.lgIdx = lgIdx;
    db.teamRows = data.teams.map(() => []); db.lgRows = data.leagues.map(() => []);
    const teamLg = data.teams.map(() => new Map());
    for (let i = 0; i < n; i++) {
      db.teamRows[db.h[i]].push(i); db.teamRows[db.a[i]].push(i); db.lgRows[db.l[i]].push(i);
      const m = teamLg[db.h[i]]; m.set(db.l[i], (m.get(db.l[i]) || 0) + 1);
    }
    db.teamLeague = teamLg.map(m => { let b = -1, c = 0; m.forEach((v, k) => { if (v > c) { c = v; b = k; } }); return b; });
    db.band = bandStats(db);
    return db;
  }


  const BINS = [1, 1.3, 1.5, 1.7, 2, 2.5, 3, 4, 6, 100];
  function bandStats(db) {   // 每個市場 x 賠率區間的歷史實測報酬(1 元平注)
    const S = { H: [], D: [], A: [], U: [] };
    for (const k in S) for (let b = 0; b < BINS.length - 1; b++) S[k].push({ n: 0, pnl: 0 });
    const put = (k, o, win) => { if (!(o > 1)) return; let b = 0; while (b < BINS.length - 2 && o >= BINS[b + 1]) b++; const s = S[k][b]; s.n++; s.pnl += win ? o - 1 : -1; };
    for (let i = 0; i < db.n; i++) {
      put('H', db.oh[i], db.res[i] === 0); put('D', db.od[i], db.res[i] === 1); put('A', db.oa[i], db.res[i] === 2);
      if (db.ou[i] > 1) put('U', db.ou[i], db.tot[i] <= 2);
    }
    return S;
  }
  function histRoi(db, k, o) {
    const S = db.band && db.band[k]; if (!S) return null;
    let b = 0; while (b < BINS.length - 2 && o >= BINS[b + 1]) b++;
    const s = S[b]; return s.n >= 100 ? { roi: s.pnl / s.n, n: s.n } : null;
  }

  function bigrams(s) { const r = new Set(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); if (s.length === 1) r.add(s); return r; }
  function resolveTeam(db, name) {
    const k = norm(name);
    if (db.nameIdx.has(k)) return { id: db.nameIdx.get(k), exact: true };
    if (!k) return { id: -1 };
    const A = bigrams(k); let best = -1, bs = 0;
    for (const [nm, id] of db.nameIdx) {
      if (Math.abs(nm.length - k.length) > 3) continue;
      const B = bigrams(nm); let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
      const s = inter / (A.size + B.size - inter);
      if (s > bs) { bs = s; best = id; }
    }
    return bs >= 0.6 ? { id: best, exact: false, score: bs } : { id: -1 };
  }
  function resolveLeague(db, name, homeId) {
    const k = norm(name);
    if (db.lgIdx.has(k)) return db.lgIdx.get(k);
    return homeId >= 0 ? db.teamLeague[homeId] : -1;
  }

  const close = (x, x0, tol) => Math.abs(x / x0 - 1) <= tol;

  function teamNeighbors(db, T, q, tol, time) {
    // q = [win, draw, loss, under] 以球隊 T 的視角
    const out = { n: 0, c: [0, 0, 0], under: 0, nU: 0, sc: {} };
    for (const i of db.teamRows[T]) {
      const home = db.h[i] === T;
      const w = home ? db.oh[i] : db.oa[i], l = home ? db.oa[i] : db.oh[i];
      if (!close(w, q[0], tol) || !close(db.od[i], q[1], tol) || !close(l, q[2], tol)) continue;
      if (q[3] > 0 && db.ou[i] > 0 && !close(db.ou[i], q[3], tol * 1.5)) continue;
      if (q[3] > 0 && db.ou[i] === 0) continue;
      if (time) {
        if (db.w[i] !== time.w || db.t[i] < 0 || Math.abs(db.t[i] * 5 - time.m) > TIME_WIN) continue;
      }
      const r = home ? db.res[i] : 2 - db.res[i];
      out.c[r]++; out.n++; out.nU++; if (db.tot[i] <= 2) out.under++;
      const k = home ? db.gh[i] + '-' + db.ga[i] : db.ga[i] + '-' + db.gh[i]; out.sc[k] = (out.sc[k] || 0) + 1;
    }
    return out;
  }
  function leagueNeighbors(db, L, q, tol, strongHome) {
    const out = { n: 0, c: [0, 0, 0], under: 0, nU: 0, sc: {} };
    if (L < 0) return out;
    for (const i of db.lgRows[L]) {
      if (!close(db.oh[i], q[0], tol) || !close(db.od[i], q[1], tol) || !close(db.oa[i], q[2], tol)) continue;
      if (q[3] > 0 && (db.ou[i] === 0 || !close(db.ou[i], q[3], tol * 1.5))) continue;
      const r = strongHome ? db.res[i] : 2 - db.res[i];
      out.c[r]++; out.n++; out.nU++; if (db.tot[i] <= 2) out.under++;
      const k = strongHome ? db.gh[i] + '-' + db.ga[i] : db.ga[i] + '-' + db.gh[i]; out.sc[k] = (out.sc[k] || 0) + 1;
    }
    return out;
  }
  function adaptive(fn, minN, tols) {
    let r = null, t = tols[0];
    for (t of tols) { r = fn(t); if (r.n >= minN) break; }
    r.tol = t; return r;
  }
  function globalNeighbors(db, q, tol, teamIds) {
    let n = 0, inv = 0; const c = [0, 0, 0]; let under = 0;
    for (let i = 0; i < db.n; i++) {
      if (!close(db.oh[i], q[0], tol) || !close(db.od[i], q[1], tol) || !close(db.oa[i], q[2], tol)) continue;
      if (q[3] > 0 && (db.ou[i] === 0 || !close(db.ou[i], q[3], tol * 1.5))) continue;
      n++; c[db.res[i]]++; if (db.tot[i] <= 2) under++;
      if (teamIds.includes(db.h[i]) || teamIds.includes(db.a[i])) inv++;
    }
    return { n, c, inv, under };
  }

  /* m: {league, home, away, oh, od, oa, ou, weekday(0=週一), minutes} */
  function analyze(db, m, opt) {
    opt = opt || {};
    const H = resolveTeam(db, m.home), A = resolveTeam(db, m.away);
    const leagueId = resolveLeague(db, m.league, H.id);
    const strongHome = m.oh <= m.oa;
    const S = strongHome ? H.id : A.id, W = strongHome ? A.id : H.id;
    const qS = strongHome ? [m.oh, m.od, m.oa, m.ou || 0] : [m.oa, m.od, m.oh, m.ou || 0];
    const qW = [qS[2], qS[1], qS[0], qS[3]];
    const q = [m.oh, m.od, m.oa, m.ou || 0];
    const L = {};
    L.L1 = S >= 0 ? adaptive(t => teamNeighbors(db, S, qS, t), MIN_N.L1, TOL1) : { n: 0, c: [0, 0, 0], tol: 0, under: 0, nU: 0, sc: {} };
    L.L2 = adaptive(t => leagueNeighbors(db, leagueId, q, t, strongHome), MIN_N.L2, TOL2);
    const time = (m.weekday != null && m.minutes != null) ? { w: m.weekday, m: m.minutes } : null;
    L.L3 = (S >= 0 && time) ? Object.assign(teamNeighbors(db, S, qS, TOL3, time), { tol: TOL3 }) : { n: 0, c: [0, 0, 0], tol: 0, under: 0, nU: 0, sc: {} };
    const l4 = W >= 0 ? adaptive(t => teamNeighbors(db, W, qW, t), MIN_N.L4, TOL1) : { n: 0, c: [0, 0, 0], tol: 0, under: 0, nU: 0, sc: {} };
    // 弱隊視角 -> 強隊視角: 弱隊勝(0) = 強隊負(2)
    const fsc = {}; Object.keys(l4.sc || {}).forEach(k => { const [a, b] = k.split('-'); fsc[b + '-' + a] = l4.sc[k]; });
    L.L4 = Object.assign({}, l4, { c: [l4.c[2], l4.c[1], l4.c[0]], sc: fsc });
    // 罕見組合偵測
    const ids = [H.id, A.id].filter(x => x >= 0);
    const g = globalNeighbors(db, q, 0.03, ids);
    const gc = strongHome ? g.c : [g.c[2], g.c[1], g.c[0]];
    const gTop = Math.max(...gc);
    const anomaly = {
      n: g.n, c: gc, teamShare: g.n ? g.inv / g.n : 0,
      rare: g.n >= 3 && g.n <= 12,
      consistent: g.n >= 3 && gTop / g.n >= 0.85,
      onlyTheseTeams: g.n >= 3 && g.inv / g.n >= 0.8,
    };
    anomaly.flag = anomaly.rare && anomaly.consistent;
    anomaly.pick = anomaly.flag ? gc.indexOf(gTop) : null;

    // 市場去水位機率(強隊視角)
    const inv = [1 / qS[0], 1 / qS[1], 1 / qS[2]], s = inv[0] + inv[1] + inv[2];
    const pm = inv.map(x => x / s);
    // 與市場混合: 市場當先驗,各層證據依權重加入(回測顯示各層沒有勝過市場,所以只做小幅修正)
    const K = opt.priorWeight || 150, Wt = { L1: 1, L2: 0.5, L3: 1, L4: 0.5 };
    const acc = pm.map(x => x * K); let tw = K;
    ['L1', 'L2', 'L3', 'L4'].forEach(k => { const w = Wt[k] * Math.min(L[k].n, 60) / Math.max(L[k].n, 1); for (let j = 0; j < 3; j++) acc[j] += w * L[k].c[j]; tw += w * L[k].n; });
    const p = acc.map(x => x / tw);
    // 小分
    let pu = null;
    if (m.ou > 0) {
      const base = interp(1 / m.ou, U_CAL); let a = base * K, w = K;
      ['L1', 'L2', 'L3', 'L4'].forEach(k => { if (L[k].nU) { const ww = Wt[k] * Math.min(L[k].nU, 60) / L[k].nU; a += ww * L[k].under; w += ww * L[k].nU; } });
      pu = { market: base, p: a / w };
    }
    // 比分綜整: 四層樣本依權重合併(強隊進球-弱隊進球),取前三
    const sc = {}; let swt = 0, nSum = 0, cnt = {};
    ['L1', 'L2', 'L3', 'L4'].forEach(k => {
      const n = L[k].n; if (!n) return; const w = Wt[k] * Math.min(n, 60) / n; nSum += n;
      Object.keys(L[k].sc || {}).forEach(key => { sc[key] = (sc[key] || 0) + w * L[k].sc[key]; cnt[key] = (cnt[key] || 0) + L[k].sc[key]; swt += w * L[k].sc[key]; });
    });
    const sl = Object.keys(sc).map(key => { const [a, b] = key.split('-').map(Number); return { key, s: a, w: b, p: sc[key] / swt, cnt: cnt[key], res: a > b ? 0 : a === b ? 1 : 2, under: a + b <= 2 }; }).sort((x, y) => y.p - x.p);
    const scoreSum = { top: sl.slice(0, 3), n: nSum, uniq: sl.length,
      pRes: [0, 1, 2].map(j => sl.filter(x => x.res === j).reduce((t, x) => t + x.p, 0)), pUnder: sl.filter(x => x.under).reduce((t, x) => t + x.p, 0) };
    return {
      scoreSum, resolved: { home: H, away: A, leagueId, league: leagueId >= 0 ? db.leagues[leagueId] : null },
      strongHome, strongName: strongHome ? m.home : m.away, weakName: strongHome ? m.away : m.home,
      layers: L, anomaly, pm, p, pu, qS,
      oddsBySide: strongHome ? { 0: m.oh, 1: m.od, 2: m.oa } : { 0: m.oa, 1: m.od, 2: m.oh },
      // 轉成「主/和/客」選項
      toHDA(idx) { return strongHome ? ['主', '和', '客'][idx] : ['客', '和', '主'][idx]; },
    };
  }

  /* 從分析結果挑單場最佳選項:賠率需 >= minOdds、機率需 >= minProb,依期望值(機率x賠率-1)排序 */
  function pickBest(an, m, minOdds, minProb, db) {
    const cand = [], KEY = { '主': 'H', '和': 'D', '客': 'A' };
    for (let j = 0; j < 3; j++) {
      const o = an.oddsBySide[j], side = an.toHDA(j);
      cand.push({ market: '勝平負', side, key: KEY[side], idx: j, odds: o, p: an.p[j], pm: an.pm[j], ev: an.p[j] * o - 1 });
    }
    if (an.pu) cand.push({ market: '小分', side: '小', key: 'U', idx: 'U', odds: m.ou, p: an.pu.p, pm: an.pu.market, ev: an.pu.p * m.ou - 1 });
    cand.forEach(c => { c.hist = db ? histRoi(db, c.key, c.odds) : null; });
    cand.sort((a, b) => b.ev - a.ev);
    const ok = cand.filter(c => c.odds >= (minOdds || 1.3) && c.p >= (minProb || 0));
    return { all: cand, best: ok[0] || null };
  }

  const api = { load, analyze, pickBest, resolveTeam, norm, MIN_N, histRoi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OH = api;
})(typeof self !== 'undefined' ? self : this);
