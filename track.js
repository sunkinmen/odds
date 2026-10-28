/* 追蹤模組:賠率快照 / 收盤線價值(CLV) / 自動結算 / 成績儀表板(純資料函式,可在 node 測試) */
(function (root) {
  const FIELD = { H: 'oh', D: 'od', A: 'oa', U: 'ou', O: 'ov' };      // 紀錄鍵 -> 快照內的賠率欄位
  const IDX = { oa: 1, od: 2, oh: 3, ou: 4, ov: 5 };                 // 快照陣列:[ts, 客, 和, 主, 小, 大]
  const keyOf = m => (m.date || '') + '|' + (m.home || '') + '|' + (m.away || '');
  const num = v => (v > 1 ? +v : 0);

  /* ---- 賠率快照:賠率有變(或第一次看到)才存一筆;每場最多 40 筆,45 天前的整場清掉 ---- */
  function record(snaps, matches, ts) {
    let n = 0;
    matches.forEach(m => {
      if (!m.date || !m.home || !m.away) return;
      const k = keyOf(m), a = snaps[k] || (snaps[k] = []), last = a[a.length - 1];
      const row = [ts, num(m.oa), num(m.od), num(m.oh), num(m.ou), num(m.ov)];
      if (last && last.slice(1).every((v, i) => v === row[i + 1])) return;
      a.push(row); if (a.length > 40) a.splice(1, a.length - 40); n++;
    });
    const cut = ts - 45 * 864e5;
    Object.keys(snaps).forEach(k => { const a = snaps[k]; if (!a.length || a[a.length - 1][0] < cut) delete snaps[k]; });
    return n;
  }
  function movement(snaps, m, key) {
    const f = FIELD[key], a = snaps[keyOf(m)]; if (!f || !a || a.length < 2) return null;
    const open = a[0][IDX[f]], now = a[a.length - 1][IDX[f]]; if (!(open > 1 && now > 1) || open === now) return null;
    return { open, now, n: a.length, pct: now / open - 1 };
  }
  const kickMs = (date, time) => (date && time && /^\d{2}:\d{2}$/.test(time)) ? Date.parse(date + 'T' + time + ':00+08:00') : null;

  /* CLV:採用時的賠率 ÷ 最後一筆(開賽前)快照的賠率 − 1。大於 0 代表拿到比收盤更好的價格。
     只有在「採用之後又有新快照」時才算,否則回傳 null(不是 0)。 */
  function clv(snaps, e) {
    const f = FIELD[e.k], a = snaps[(e.date || '') + '|' + (e.home || '') + '|' + (e.away || '')];
    if (!f || !a || !(e.odds > 1)) return null;
    const kick = e.kick || null;
    let close = null;
    for (const s of a) { if (s[0] <= (e.ts || 0)) continue; if (kick && s[0] > kick) break; close = s; }
    if (!close || !(close[IDX[f]] > 1)) return null;
    return { close: close[IDX[f]], clv: e.odds / close[IDX[f]] - 1 };
  }

  /* ---- 自動結算:用資料庫裡的賽果比對 日期|主隊|客隊 ---- */
  function resultIndex(data) {
    const m = new Map();
    for (let i = 0; i < data.n; i++) m.set(data.d[i] + '|' + data.teams[data.h[i]] + '|' + data.teams[data.a[i]], [data.ga[i], data.gh[i]]);
    return m;
  }
  const yymmdd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? (+m[1] - 2000) * 10000 + +m[2] * 100 + +m[3] : 0; };
  function splitLabel(label) { const p = String(label || '').split(' @ '); return p.length === 2 ? { away: p[0], home: p[1] } : null; }
  function autoSettle(LOG, SCORES, idx) {
    let n = 0;
    LOG.forEach(x => {
      if (x.hit != null || SCORES[x.id]) return;
      let home = x.home, away = x.away; if (!home) { const s = splitLabel(x.label); if (!s) return; home = s.home; away = s.away; }
      const r = idx.get(yymmdd(x.date) + '|' + home + '|' + away); if (r) { SCORES[x.id] = [r[0], r[1]]; n++; }
    });
    return n;
  }

  /* ---- 儀表板統計 ---- */
  const BINS = [[0, .3], [.3, .4], [.4, .5], [.5, .6], [.6, .7], [.7, 1.01]];
  function dash(LOG, snaps, judgeFn) {
    const seen = new Set(), done = [];
    LOG.forEach(x => { if (x.hit == null) return; const u = x.id + '|' + x.k; if (seen.has(u)) return; seen.add(u); done.push(x); });
    const agg = a => { const n = a.length, hits = a.filter(x => x.hit).length, ret = a.reduce((t, x) => t + (x.hit ? x.odds : 0) - 1, 0), exp = a.reduce((t, x) => t + x.p, 0), expRet = a.reduce((t, x) => t + x.p * x.odds - 1, 0); return { n, hits, hitRate: n ? hits / n : 0, expHit: n ? exp / n : 0, roi: n ? ret / n : 0, expRoi: n ? expRet / n : 0 }; };
    const bins = BINS.map(([a, b]) => { const s = done.filter(x => x.p >= a && x.p < b), g = agg(s); return { a, b: Math.min(b, 1), n: g.n, pred: g.expHit, act: g.hitRate }; });
    const byGrade = ['A', 'B', 'C'].map(g => ({ g, s: agg(done.filter(x => x.grade === g)) }));
    const cl = LOG.map(x => clv(snaps, x)).filter(Boolean);
    const clvAvg = cl.length ? cl.reduce((t, c) => t + c.clv, 0) / cl.length : null, clvPos = cl.filter(c => c.clv > 0).length;
    return { all: agg(done), bins, byGrade, clvN: cl.length, clvAvg, clvPos, pending: LOG.filter(x => x.hit == null).length, snapMatches: Object.keys(snaps).length };
  }
  const P = x => (x * 100).toFixed(0) + '%';
  function dashHtml(d) {
    if (!d.all.n && !d.pending) return '<div class="plan"><h4>成績儀表板</h4><div class="rs">還沒有紀錄。到「顧問」按「採用並記錄」後,賽事結束會自動結算。</div></div>';
    const a = d.all;
    let h = '<div class="plan"><h4>成績儀表板(自動結算)</h4>';
    h += `<div class="pl"><span>已結算 / 待結算</span><b>${a.n} / ${d.pending} 筆</b><span>命中率(實際 vs 模型預期)</span><b>${a.n ? `${P(a.hitRate)} vs ${P(a.expHit)}` : '—'}</b><span>平均每注報酬(實際 vs 預期)</span><b>${a.n ? `${(a.roi * 100).toFixed(0)}% vs ${(a.expRoi * 100).toFixed(0)}%` : '—'}</b><span>平均收盤線價值 CLV</span><b>${d.clvN ? `${(d.clvAvg * 100).toFixed(1)}%(${d.clvPos}/${d.clvN} 筆優於收盤)` : '尚無(採用後需再更新賽事產生新賠率)'}</b></div>`;
    if (a.n) {
      h += '<div class="rs" style="margin-top:8px">校準檢查:模型說的機率 vs 實際命中</div>';
      h += d.bins.filter(b => b.n).map(b => `<div class="cal"><span>${P(b.a)}~${P(b.b)}</span><div class="cb"><i class="pr" style="width:${b.pred * 100}%"></i><i class="ac" style="width:${b.act * 100}%"></i></div><span>預 ${P(b.pred)} / 實 ${P(b.act)}(${b.n})</span></div>`).join('');
      h += '<div class="rs" style="margin-top:8px">依評等</div>' + d.byGrade.filter(x => x.s.n).map(x => `<div class="pl"><span>評等 ${x.g}</span><b>${x.s.hits}/${x.s.n} 中(${P(x.s.hitRate)})・報酬 ${(x.s.roi * 100).toFixed(0)}%</b></div>`).join('');
    }
    h += `<div class="hint">樣本少時隨機波動很大,至少累積 100 筆再看。對照:2026 年 2.2 萬場回測,依本模型選項的平均報酬約 −14.5%(抽水約 23%)。CLV 需要採用前後都有賠率快照(目前追蹤 ${d.snapMatches} 場),App 每次更新賽事會自動記錄。</div></div>`;
    return h;
  }
  const api = { keyOf, record, movement, clv, kickMs, resultIndex, autoSettle, dash, dashHtml, yymmdd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHT = api;
})(typeof self !== 'undefined' ? self : this);
