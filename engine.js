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
  /* ---- 機器學習校準模型 v1(多項邏輯迴歸):用 2025-01~2026-10 逐月樣本外預測訓練。
     特徵:log(市場去水位機率)×3,加上四層「與市場的差距×樣本可信度」×12;輸出強隊勝/和/強隊負。
     樣本外回測(2026,2.2 萬場)log loss 0.9934,比市場基準 0.9982 好 0.0048;梯度提升模型較差(0.9945),所以採用此版。 */
  const ML_W = [[0.449145,-0.691981,-0.64648,0.092111,-0.014851,-0.077261,0.07238,0.021289,-0.093668,0.174433,-0.323385,0.148952,-0.090438,-0.13156,0.221998],[-0.218969,1.010789,-0.337303,-0.020008,0.12192,-0.101912,0.024004,-0.017321,-0.006683,-0.206161,-0.005307,0.211468,0.136048,0.041259,-0.177307],[-0.230176,-0.318808,0.983782,-0.072103,-0.107069,0.179173,-0.096384,-0.003968,0.100352,0.031728,0.328692,-0.36042,-0.04561,0.090301,-0.044691]];
  const ML_B = [-0.998334, 0.533032, 0.465302];
  function mlProb(pm, L) {
    const x = pm.map(v => Math.log(Math.min(1, Math.max(1e-4, v))));
    ['L1', 'L2', 'L3', 'L4'].forEach(k => {
      const n = L[k].n, s = Math.min(n, 60) / (Math.min(n, 60) + 20);
      for (let j = 0; j < 3; j++) x.push(((n > 0 ? L[k].c[j] / n : pm[j]) - pm[j]) * s);
    });
    const z = ML_W.map((w, j) => w.reduce((t, v, i) => t + v * x[i], ML_B[j])), mx = Math.max(...z), ex = z.map(v => Math.exp(v - mx)), s = ex[0] + ex[1] + ex[2];
    return ex.map(v => v / s);
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


  /* ---- 鎖定邏輯 v2:以「主賠、客賠」為鍵的相近賠率(使用者手動規則自動化) ----
     主/客賠率容許差(絕對值):1.x ±0.10、2.x ±0.15、3.x ±0.20、4.x ±0.30、5.x ±0.50、6 以上 ±1.00。
     和局賠率以 3 為起點每 0.25 一個區間:同區間=高度相符,相鄰區間=大致相符;小分賠率不當條件。
     自動分級:同聯賽「高度相符」>=3 場就用高度;不足才放寬到「含大致相符」。 */
  const tolO = o => o < 2 ? 0.10 : o < 3 ? 0.15 : o < 4 ? 0.20 : o < 5 ? 0.30 : o < 6 ? 0.50 : 1.00;
  const drawBand = o => Math.floor((o - 3) / 0.25 + 1e-6);
  const ANOM = { maxN: 15, minShare: 0.7 };   // 異常篩選:同聯賽同賠率組合樣本 3~15 場,且結果(勝平負或大小分)>=70% 同向
  function comboScan(db, m, L, asOf) {
    const th = tolO(m.oh) + 1e-4, ta = tolO(m.oa) + 1e-4, bd = drawBand(m.od);
    const lv = [{ nAll: 0, nLg: 0, c: [0, 0, 0], under: 0, over: 0 }, { nAll: 0, nLg: 0, c: [0, 0, 0], under: 0, over: 0 }];
    const rows = [];
    for (let i = 0; i < db.n; i++) {
      if (asOf && db.d[i] >= asOf) continue;
      if (Math.abs(db.oh[i] - m.oh) > th || Math.abs(db.oa[i] - m.oa) > ta) continue;
      const dd = Math.abs(drawBand(db.od[i]) - bd); if (dd > 1) continue;
      for (let k = dd; k < 2; k++) {
        const g = lv[k]; g.nAll++; if (db.l[i] !== L) continue;
        g.nLg++; g.c[db.res[i]]++; if (db.tot[i] <= 2) g.under++; else g.over++;
      }
      if (db.l[i] === L) rows.push([i, dd]);
    }
    return { lv, rows };
  }
  const tierOf = (n, share) => n < 3 ? 3 : (n <= 15 && share >= 0.78) ? 0 : (n <= 30 && share >= 0.7) ? 1 : 2;   // share = 貝氏收縮後機率
  function combo(db, m, L, asOf) {
    if (!(m.oh > 0 && m.od > 0 && m.oa > 0) || L < 0) return { lvl: 0, tolTxt: '', nAll: 0, nLg: 0, c: [0, 0, 0], under: 0, over: 0, lgShare: 0, hda: null, ou: null, share: 0, tier: 3, prior: [] };
    const sc = comboScan(db, m, L, asOf); const lvl = sc.lv[0].nLg >= 3 ? 0 : 1, g = sc.lv[lvl];
    const r = { lvl, lvlTxt: lvl === 0 ? '高度相符' : '大致相符', tolTxt: '主±' + tolO(m.oh).toFixed(2) + '・客±' + tolO(m.oa).toFixed(2) + '・和局' + (lvl === 0 ? '同區間' : '±1區間'), nAll: g.nAll, nLg: g.nLg, c: g.c, under: g.under, over: g.over };
    r.lgShare = r.nAll ? r.nLg / r.nAll : 0;
    const od = [m.oh, m.od, m.oa]; let ti = 0; for (let j = 1; j < 3; j++) if (r.c[j] > r.c[ti] || (r.c[j] === r.c[ti] && od[j] < od[ti])) ti = j;
    const MM = root.OHM || (typeof require !== 'undefined' ? require('./model.js') : null), pm0 = MM ? MM.devig(od) : [1 / 3, 1 / 3, 1 / 3];
    r.hda = r.nLg ? { idx: ti, key: 'HDA'[ti], side: ['主', '和', '客'][ti], cnt: r.c[ti], share: r.c[ti] / r.nLg } : null;
    if (r.hda && MM) r.hda.shr = MM.shrink(r.hda.cnt, r.nLg, pm0[ti], 8);   // 貝氏收縮:向市場去水位機率靠攏
    const nu = r.under + r.over;
    if (nu) { const u = r.under > r.over || (r.under === r.over && !(m.ov > 0 && m.ov < m.ou)); r.ou = u ? { key: 'U', side: '小', cnt: r.under, share: r.under / nu } : { key: 'O', side: '大', cnt: r.over, share: r.over / nu };
      const pu0 = m.ou > 0 ? (m.ov > 0 ? (1 / m.ou) / (1 / m.ou + 1 / m.ov) : interp(1 / m.ou, U_CAL)) : 0.5; if (MM) r.ou.shr = MM.shrink(r.ou.cnt, nu, u ? pu0 : 1 - pu0, 8); } else r.ou = null;
    const sOf = x => x ? (x.shr ? x.shr.p : x.share) : 0;
    r.share = Math.max(sOf(r.hda), sOf(r.ou)); r.tier = tierOf(r.nLg, r.share);
    /* 最近前例(同聯賽、符合本次分級),新到舊最多 5 場 */
    r.prior = sc.rows.filter(x => x[1] <= lvl).sort((x, y) => db.d[y[0]] - db.d[x[0]]).slice(0, 5).map(([i, dd]) => ({ d: db.d[i], h: db.teams[db.h[i]], a: db.teams[db.a[i]], ga: db.ga[i], gh: db.gh[i], oh: +db.oh[i].toFixed(2), od: +db.od[i].toFixed(2), oa: +db.oa[i].toFixed(2), dd }));
    return r;
  }
  /* ---- 三組「相近賠率」常見比分(同聯賽) ----
     home: 這支主隊「主場」在相近賠率組合下的歷史比分;away: 這支客隊「客場」在相近賠率組合下;
     slot: 同聯賽所有球隊,同星期、開賽時間相近(±30分,不足放寬到 ±90、±180)且相近賠率組合下。
     相近賠率=主客賠率在分段容許差內,和局同 0.25 區間(高度相符)或相鄰區間(大致相符);樣本不足 3 場時自動放寬。 */
  function pack(rows, db) {
    const counts = {}; rows.forEach(i => { const k = db.ga[i] + ':' + db.gh[i]; counts[k] = (counts[k] || 0) + 1; });
    const top = Object.keys(counts).map(k => { const [a, h] = k.split(':').map(Number); return { a, h, cnt: counts[k] }; }).sort((x, y) => y.cnt - x.cnt || (y.a + y.h) - (x.a + x.h)).slice(0, 3);
    return { n: rows.length, counts, top };
  }
  function simSources(db, m, H, A, L, asOf) {
    const out = { home: null, away: null, slot: null };
    if (L < 0 || !(m.oh > 0 && m.od > 0 && m.oa > 0)) return out;
    const th = tolO(m.oh) + 1e-4, ta = tolO(m.oa) + 1e-4, bd = drawBand(m.od);
    const hr = [], ar = [], sr = [];
    for (const i of db.lgRows[L]) {
      if (asOf && db.d[i] >= asOf) continue;
      if (Math.abs(db.oh[i] - m.oh) > th || Math.abs(db.oa[i] - m.oa) > ta) continue;
      const dd = Math.abs(drawBand(db.od[i]) - bd); if (dd > 1) continue;
      if (H >= 0 && db.h[i] === H) hr.push([i, dd]);
      if (A >= 0 && db.a[i] === A) ar.push([i, dd]);
      if (m.weekday != null && m.minutes != null && db.w[i] === m.weekday && db.t[i] >= 0) sr.push([i, dd, Math.abs(db.t[i] * 5 - m.minutes)]);
    }
    const lvlOf = (rows) => { const n0 = rows.filter(r => r[1] === 0).length; return n0 >= 3 ? 0 : 1; };
    [['home', hr], ['away', ar]].forEach(([k, rows]) => { const lv = lvlOf(rows), pick = rows.filter(r => r[1] <= lv).map(r => r[0]); out[k] = Object.assign(pack(pick, db), { lvl: lv }); });
    if (sr.length) {
      for (const [lv, win] of [[0, 30], [1, 30], [1, 90], [1, 180]]) {
        const pick = sr.filter(r => r[1] <= lv && r[2] <= win).map(r => r[0]);
        out.slot = Object.assign(pack(pick, db), { lvl: lv, win }); if (pick.length >= 3) break;
      }
    } else out.slot = Object.assign(pack([], db), { lvl: 1, win: 180 });
    return out;
  }
  /* 綜整前三比分:市場隱含進球模型(先驗)+ 三組歷史比分(證據)貝氏合併 */
  function recScores(db, m, H, A, L, asOf, opt) {
    const M = (root.OHM || (typeof require !== 'undefined' ? require('./model.js') : null)); if (!M) return null;
    opt = opt || {};
    let pU = null; if (m.ou > 0) pU = m.ov > 0 ? (1 / m.ou) / (1 / m.ou + 1 / m.ov) : interp(1 / m.ou, U_CAL);
    const sm = M.scoreModel(m.oh, m.od, m.oa, pU);
    const src = simSources(db, m, H, A, L, asOf);
    const list = ['home', 'away', 'slot'].map(k => src[k] ? { n: src[k].n, counts: src[k].counts, w: opt.w ? opt.w[k] : 1 } : null);
    const post = M.blendScores(sm.M, list, { alpha: opt.alpha || 12, cap: opt.cap || 25 });
    return { model: sm, src, top: post.slice(0, 3), modelTop: M.modelTop(sm.M, 3) };
  }

  /* 同聯賽 + 同星期 + 開賽時間 ±30 分(不足 20 場放寬到 ±90 分)的前三高比分(客:主) */
  function slotScores(db, L, w, minutes) {
    if (L < 0 || w == null || minutes == null) return null;
    let res = null;
    for (const win of [30, 90]) {
      const cnt = new Map(); let n = 0;
      for (const i of db.lgRows[L]) {
        if (db.w[i] !== w || db.t[i] < 0 || Math.abs(db.t[i] * 5 - minutes) > win) continue;
        n++; const k = db.ga[i] + ':' + db.gh[i]; cnt.set(k, (cnt.get(k) || 0) + 1);
      }
      res = { n, win, top: [...cnt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => { const [a, h] = k.split(':').map(Number); return { a, h, cnt: v }; }) };
      if (n >= 20) break;
    }
    return res;
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
    const pBlend = acc.map(x => x / tw);
    const p = opt.noML ? pBlend : mlProb(pm, L);   // 預設套用機器學習校準
    // 小分
    let pu = null;
    if (m.ou > 0) {
      const base = m.ov > 0 ? (1 / m.ou) / (1 / m.ou + 1 / m.ov) : interp(1 / m.ou, U_CAL); let a = base * K, w = K;
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
    // 高比分尾端(大3.5 / 大4.5):用比分分布與大小盤去水位機率混合,只在「可能性相對市場升高」時標記
    const tail = [];
    [3.5, 4.5].forEach(Ln => {
      const pr = m.lines && m.lines[Ln]; if (!pr || !(pr[0] > 1 && pr[1] > 1)) return;
      const pmT = (1 / pr[0]) / (1 / pr[0] + 1 / pr[1]), frac = swt ? sl.filter(x => x.s + x.w >= Ln + 0.5).reduce((t, x) => t + x.p, 0) : pmT, ew = Math.min(swt || 0, 150);
      const pT = (pmT * 150 + frac * ew) / (150 + ew);
      tail.push({ line: Ln, key: Ln === 3.5 ? 'O35' : 'O45', odds: pr[0], p: pT, pm: pmT, frac, ev: pT * pr[0] - 1, flag: swt > 0 && pT - pmT >= (Ln === 3.5 ? 0.025 : 0.03) && frac >= pmT * (Ln === 3.5 ? 1.15 : 1.3) });
    });
    return {
      tail, scoreSum, resolved: { home: H, away: A, leagueId, league: leagueId >= 0 ? db.leagues[leagueId] : null },
      strongHome, strongName: strongHome ? m.home : m.away, weakName: strongHome ? m.away : m.home,
      layers: L, anomaly, pm, p, pBlend, pu, qS, combo: combo(db, m, leagueId), slot: slotScores(db, leagueId, m.weekday, m.minutes), rec: recScores(db, m, H.id, A.id, leagueId),
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
    if (an.pu && m.ov > 1) cand.push({ market: '大分', side: '大', key: 'O', idx: 'O', odds: m.ov, p: 1 - an.pu.p, pm: 1 - an.pu.market, ev: (1 - an.pu.p) * m.ov - 1 });
    (an.tail || []).filter(t => t.flag).forEach(t => cand.push({ market: '大分', side: '大' + t.line, key: t.key, idx: t.key, odds: t.odds, p: t.p, pm: t.pm, ev: t.ev }));
    cand.forEach(c => { c.hist = db ? histRoi(db, c.key, c.odds) : null; });
    cand.sort((a, b) => b.ev - a.ev);
    /* 鎖定邏輯:每場「勝平負」「大小分」各取一個最佳(t1/t2)。
       有同聯賽同賠率樣本(>=3 場)→ 取結果最集中者;沒有 → 取市場熱門(最低賠率 / 去水位後機率較高的一邊)。
       建議(實心)=異常場次:只會從 t1/t2 之中挑,樣本 3~15 場、集中度>=70%、賠率>=minOdds,集中度高者優先,所以實心必然與虛線重疊。 */
    const cb = an.combo || null, mk = k => cand.find(c => c.key === k) || null;
    const lg = cb && cb.nLg >= 3;
    let t1 = null, t2 = null;
    if (lg && cb.hda) { t1 = mk(cb.hda.key); if (t1) t1.cx = { share: cb.hda.shr ? cb.hda.shr.p : cb.hda.share, raw: cb.hda.share, cnt: cb.hda.cnt, n: cb.nLg, src: 'league' }; }
    if (!t1) t1 = cand.filter(c => c.market === '勝平負' && c.odds > 1).sort((a, b) => a.odds - b.odds)[0] || null;
    if (lg && cb.ou) { t2 = mk(cb.ou.key); if (t2) t2.cx = { share: cb.ou.shr ? cb.ou.shr.p : cb.ou.share, raw: cb.ou.share, cnt: cb.ou.cnt, n: cb.nLg, src: 'league' }; }
    if (!t2) { const U = mk('U'), O = mk('O'); t2 = U && O ? (an.pu.market >= 0.5 ? U : O) : (U || null); }
    const ok = [t1, t2].filter(c => c && c.cx && c.cx.src === 'league' && c.cx.share >= ANOM.minShare && c.cx.n <= ANOM.maxN && c.odds >= (minOdds || 1.3));
    ok.sort((a, b) => b.cx.share - a.cx.share || a.cx.n - b.cx.n);
    return { all: cand, best: ok[0] || null, t1, t2 };
  }

  const api = { load, analyze, mlProb, pickBest, resolveTeam, norm, MIN_N, histRoi, combo, slotScores, tierOf, ANOM, simSources, recScores, tolO, drawBand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OH = api;
})(typeof self !== 'undefined' ? self : this);
