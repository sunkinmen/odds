/* 投注顧問:規則式解讀 + 方案(免金鑰)、Gemini 方案(自備免費金鑰)、紀錄結算。瀏覽器 / Node 共用。
 * 原則:AI 只能從模型算出的候選裡挑;賠率、機率一律用本機計算值;預算由使用者設定且不可超過。 */
(function (root) {
  const LAB = { H: '主勝', D: '和局', A: '客勝', U: '小分(總進球≤2)' };
  const P0 = x => Math.round(x * 100) + '%';
  const r10 = x => Math.max(0, Math.floor(x / 10) * 10);

  /* ---- 把分析結果整理成顧問用的 item(純資料) ---- */
  function makeItem(m, an, pb, o) {
    o = o || {};
    const S = an.scoreSum, best = pb.best;
    const cands = pb.all.filter(c => c.odds >= (o.minOdds || 1.3)).map(c => ({ k: c.key, label: LAB[c.key], odds: c.odds, p: c.p, pm: c.pm, ev: c.ev, hist: c.hist ? c.hist.roi : null }));
    const lay = {}; ['L1', 'L2', 'L3', 'L4'].forEach(k => { const L = an.layers[k], n = L.c[0] + L.c[1] + L.c[2]; lay[k] = { n, c: L.c.slice() }; });
    const fix = k => k.split('-').map(Number);
    const tops = S.top.map(x => { const [a, b] = fix(x.key); return { score: an.strongHome ? `客${b}:主${a}` : `客${a}:主${b}`, pct: x.p, cnt: x.cnt, res: x.res }; });
    const it = { id: m.id, label: `${m.away} @ ${m.home}`, away: m.away, home: m.home, league: m.league || (an.resolved.league || ''), time: m.time || '', date: m.date || '', minLeg: o.minLegOf ? o.minLegOf(m) : (m.minLeg || 1), cands, tops, nScore: S.n, layers: lay, strongName: an.strongName, strongHome: an.strongHome, pRes: S.pRes, anomaly: an.anomaly.flag ? { n: an.anomaly.n, pick: an.toHDA(an.anomaly.pick) } : null, unknownTeam: [an.resolved.home, an.resolved.away].some(x => x.id < 0) };
    it.best = best ? it.cands.find(c => c.k === best.key && c.odds === best.odds) || null : null;
    const ex = explain(it, an); it.grade = ex.grade; it.reasons = ex.reasons; it.warns = ex.warns;
    return it;
  }

  /* ---- 規則式解讀(不需金鑰) ---- */
  function explain(it, an) {
    const c = it.best, reasons = [], warns = [];
    if (!c) return { grade: 'C', reasons: ['沒有同時滿足最低賠率與最低機率的選項'], warns: [] };
    const idx = c.k === 'H' ? (it.strongHome ? 0 : 2) : c.k === 'A' ? (it.strongHome ? 2 : 0) : c.k === 'D' ? 1 : null;
    reasons.push(`評等是相對評等:看模型比市場多出多少優勢與幾層同向,不代表會賺。模型機率 ${P0(c.p)},市場隱含 ${P0(c.pm)}(${c.p >= c.pm ? '+' : ''}${((c.p - c.pm) * 100).toFixed(1)} 點),期望值 ${(c.ev * 100).toFixed(0)}%`);
    let agree = 0, tot = 0;
    if (idx != null) ['L1', 'L2', 'L3', 'L4'].forEach(k => { const L = it.layers[k]; if (L.n >= 5) { tot++; if (L.c.indexOf(Math.max(...L.c)) === idx) agree++; } });
    if (idx != null && tot) reasons.push(`${tot} 層有足夠樣本,其中 ${agree} 層最常見結果與此選項一致`);
    if (idx != null && it.tops.length) { const t = it.tops[0]; reasons.push(`最常見比分 ${t.score}(${P0(t.pct)},母數 ${it.nScore} 場)${t.res === idx ? ',與此選項同向' : ',與此選項不同向'}`); }
    if (c.hist != null) reasons.push(`同市場同賠率區間歷史平均報酬 ${(c.hist * 100).toFixed(0)}%`);
    if (it.anomaly) reasons.push(`罕見賠率組合:歷史 ${it.anomaly.n} 場多數同向(${it.anomaly.pick}),但回測中此訊號沒有勝過選熱門`);
    if (it.layers.L1.n < 8) warns.push(`強隊同賠率樣本僅 ${it.layers.L1.n} 場,參考性低`);
    if (it.unknownTeam) warns.push('有球隊查無歷史,四層樣本可能不足');
    if (c.odds >= 4) warns.push('高賠率區間歷史報酬明顯偏負(約 −34%),命中率也低');
    if (c.ev < 0) warns.push('期望值為負:長期平均會虧,只是相對較佳的選項');
    const bad = warns.filter(w => w.indexOf('期望值為負') < 0).length;
    let g = 'C';
    const edge = (c.p - c.pm) * c.odds;   // 模型相對市場的優勢(扣掉水位後的相對評等,不是絕對期望值)
    if (edge >= 0.04 && agree >= 3) g = 'A'; else if (edge >= 0.01 && agree >= 2) g = 'B';
    if (bad >= 1 && g === 'A') g = 'B'; else if (bad >= 2 && g === 'B') g = 'C';
    return { grade: g, reasons, warns, agree, tot };
  }

  /* ---- 規則方案:單場 + 系統串關,受預算限制 ---- */
  function rulePlan(items, o) {
    o = Object.assign({ budget: 1000, minOdds: 1.6, minProb: 0.4, maxSingles: 3, SYS: null, calc: null }, o || {});
    const el = items.filter(i => i.best && i.best.odds >= o.minOdds && i.best.p >= o.minProb).sort((a, b) => b.best.ev - a.best.ev);
    const plan = { src: 'rule', summary: '', singles: [], parlay: null, skips: [], risks: [] };
    const sBudget = o.budget * 0.4, pBudget = o.budget * 0.6;
    const good = el.filter(i => i.grade !== 'C'), ss = good.slice(0, o.maxSingles);
    ss.forEach(i => plan.singles.push({ id: i.id, k: i.best.k, stake: r10(sBudget / Math.max(1, ss.length)), reason: i.reasons[0] }));
    const used = new Set();
    const legs = good.slice(0, 4);
    if (legs.length >= 2 && o.SYS && o.calc) {
      const N = legs.length, L = legs.map(i => ({ odds: i.best.odds, p: i.best.p, minLeg: i.minLeg || 1 }));
      let bestT = null;
      (o.SYS[N] || []).forEach(t => {
        const r = o.calc(L, t[1], 1); if (!r.bets) return;
        const per = r10(pBudget / r.bets); if (per < 10) return;
        if (!bestT || r.ev > bestT.r.ev) bestT = { t, r, per };
      });
      if (bestT) plan.parlay = { type: bestT.t[0], legs: legs.map(i => ({ id: i.id, k: i.best.k })), stakePer: bestT.per, reason: `取期望值較高的 ${N} 場,${bestT.t[0]} 共 ${bestT.r.bets} 注` };
    }
    plan.skips = items.filter(i => !el.includes(i)).slice(0, 8).map(i => ({ id: i.id, reason: i.best ? '機率或賠率未達設定門檻' : '沒有合格選項' }));
    plan.summary = good.length ? `從 ${items.length} 場中挑出 ${good.length} 場評等 A/B 且合格的場次,依期望值排序;單場取前 ${ss.length} 場${plan.parlay ? ',另配一組系統串關' : ''}。` : el.length ? `${el.length} 場雖達賠率與機率門檻,但評等都是 C(樣本不足、期望值明顯為負或有警示),建議今天不投注。若仍想看,可到賽事頁逐場查看。` : `${items.length} 場中沒有場次同時滿足最低賠率 ${o.minOdds} 與最低機率 ${P0(o.minProb)},建議今天不投注。`;
    plan.risks = ['期望值多為負,長期平均會虧損(回測:各層與組合在樣本外都沒勝過市場)', '這只是依規則排序的結果,不含傷兵、陣容等消息面'];
    return plan;
  }

  /* ---- 驗證方案(不論來源):只允許本機算出的候選、預算不得超過 ---- */
  function validatePlan(plan, items, o) {
    o = Object.assign({ budget: 1000, minOdds: 1.6, SYS: null, calc: null }, o || {});
    const by = new Map(items.map(i => [i.id, i])), issues = [];
    const out = { src: plan.src || 'ai', summary: String(plan.summary || ''), singles: [], parlay: null, skips: [], risks: (plan.risks || []).map(String).slice(0, 6), news: plan.news || {} };
    const seen = new Set();
    (plan.singles || []).forEach(s => {
      const it = by.get(s.id), c = it && it.cands.find(x => x.k === s.k);
      if (!it || !c) { issues.push(`單場「${s.id}」不在候選中,已剔除`); return; }
      if (c.odds < o.minOdds) { issues.push(`${it.label} 賠率 ${c.odds} 低於門檻,已剔除`); return; }
      if (seen.has(s.id)) return; seen.add(s.id);
      out.singles.push({ id: s.id, k: s.k, stake: r10(+s.stake || 0), reason: String(s.reason || '') });
    });
    const P = plan.parlay;
    if (P && P.legs && o.SYS && o.calc) {
      const legs = []; const ids = new Set();
      P.legs.forEach(l => { const it = by.get(l.id), c = it && it.cands.find(x => x.k === l.k); if (it && c && c.odds >= o.minOdds && !ids.has(l.id)) { ids.add(l.id); legs.push({ id: l.id, k: l.k }); } else issues.push(`串關腿「${l.id}」無效,已剔除`); });
      const N = legs.length, t = (o.SYS[N] || []).find(x => x[0] === P.type);
      if (N >= 2 && t) {
        const L = legs.map(l => { const it = by.get(l.id), c = it.cands.find(x => x.k === l.k); return { odds: c.odds, p: c.p, minLeg: it.minLeg || 1 }; });
        const r = o.calc(L, t[1], 1);
        if (r.bets) out.parlay = { type: P.type, legs, stakePer: r10(+P.stakePer || 0), reason: String(P.reason || '') };
        else issues.push('串關型態與場次的最低串數不相容,已剔除');
      } else if (P.legs.length) issues.push(`串關型態「${P.type}」與有效場數 ${N} 不符,已剔除`);
    }
    // 預算
    const cost = () => out.singles.reduce((t, s) => t + s.stake, 0) + (out.parlay ? out.parlay.stakePer * (function () { const L = out.parlay.legs.map(l => { const it = by.get(l.id), c = it.cands.find(x => x.k === l.k); return { odds: c.odds, p: c.p, minLeg: it.minLeg || 1 }; }); return o.calc(L, o.SYS[out.parlay.legs.length].find(x => x[0] === out.parlay.type)[1], 1).bets; })() : 0);
    let c0 = cost();
    if (c0 > o.budget && c0 > 0) { const f = o.budget / c0; out.singles.forEach(s => s.stake = r10(s.stake * f)); if (out.parlay) out.parlay.stakePer = r10(out.parlay.stakePer * f); issues.push(`原方案 ${c0} 元超過預算 ${o.budget},已等比例縮減`); }
    out.singles = out.singles.filter(s => s.stake >= 10); if (out.parlay && out.parlay.stakePer < 10) out.parlay = null;
    out.cost = cost(); out.issues = issues;
    out.skips = (plan.skips || []).filter(s => by.has(s.id)).map(s => ({ id: s.id, reason: String(s.reason || '') })).slice(0, 12);
    return out;
  }

  /* ---- Gemini ---- */
  function buildPrompt(items, o) {
    const rows = items.slice(0, o.maxItems || 25).map(i => ({
      id: i.id, 賽事: i.label, 聯賽: i.league, 時間: (i.date || '').slice(5) + ' ' + i.time, 最低串數: i.minLeg > 1 ? i.minLeg : undefined,
      選項: i.cands.map(c => ({ k: c.k, 名稱: c.label, 賠率: c.odds, 模型機率: +c.p.toFixed(3), 市場機率: +c.pm.toFixed(3), 期望值: +c.ev.toFixed(3), 同區間歷史報酬: c.hist == null ? undefined : +c.hist.toFixed(3) })),
      前三比分: i.tops.map(t => `${t.score} ${P0(t.pct)}`), 比分母數: i.nScore, 規則評等: i.grade, 規則提醒: i.warns.length ? i.warns : undefined
    }));
    const types = Object.keys(o.SYSnames || {}).length ? o.SYSnames : {};
    return `你是足球投注風險顧問,使用繁體中文。以下是台灣運彩足球賽事,賠率、機率、期望值皆為本機模型算出,不可更改或自行編造。\n` +
      `重要背景:回測顯示模型在樣本外沒有勝過市場,多數選項期望值為負;你的工作是在這個前提下做相對較佳、風險受控的選擇,並誠實指出風險,不可宣稱穩賺。\n` +
      `限制:每日預算 ${o.budget} 元(含單場與串關總額,不得超過,金額為 10 的倍數);只能從下列賽事與選項(用 id 與 k 指定)挑;賠率需 ≥ ${o.minOdds};有「最低串數」的賽事只能放進場數 ≥ 該值的串關;串關型態從 ${JSON.stringify(types)} 中選(鍵=串關場數,值=可用型態)。\n` +
      (o.search ? `請先用搜尋查各場的傷兵、停賽、陣容輪換與近期狀況,把有影響的重點寫在 news(以 id 為鍵,一句話),找不到就不要寫。\n` : '') +
      `只輸出 JSON,格式:{"summary":"一兩句總結","singles":[{"id":"","k":"H|D|A|U","stake":數字,"reason":"一句話理由"}],"parlay":{"type":"如 4串5","legs":[{"id":"","k":""}],"stakePer":每注金額,"reason":""}或null,"skips":[{"id":"","reason":""}],"risks":["風險1","風險2"],"news":{"id":"重點"}}\n` +
      `若沒有值得投注的場次,singles 與 parlay 留空並在 summary 說明建議不投注。\n賽事資料:\n` + JSON.stringify(rows);
  }
  async function callGemini(key, model, prompt, search, fetchImpl) {
    const f = fetchImpl || fetch;
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } };
    if (search) body.tools = [{ google_search: {} }]; else body.generationConfig.responseMimeType = 'application/json';
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    const txt = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('');
    return parseJson(txt);
  }
  function parseJson(t) {
    t = String(t || '').replace(/```json|```/g, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('AI 沒有回傳 JSON');
    return JSON.parse(t.slice(a, b + 1));
  }

  /* ---- 紀錄結算 ---- */
  function judge(key, ga, gh) { return key === 'H' ? gh > ga : key === 'A' ? ga > gh : key === 'D' ? ga === gh : ga + gh <= 2; }
  function parseScore(s) { const m = String(s || '').match(/^\s*(\d{1,2})\s*[-:：]\s*(\d{1,2})\s*$/); return m ? [+m[1], +m[2]] : null; }   // 客-主
  function stats(log) {
    const done = log.filter(x => x.hit != null);
    const o = { n: log.length, done: done.length, hits: done.filter(x => x.hit).length, ret: 0, stake: 0, expP: 0, expEv: 0 };
    done.forEach(x => { o.stake += 1; o.ret += x.hit ? x.odds : 0; o.expP += x.p; o.expEv += x.ev; });
    o.hitRate = o.done ? o.hits / o.done : 0; o.roi = o.done ? o.ret / o.stake - 1 : 0; o.expHit = o.done ? o.expP / o.done : 0; o.expRoi = o.done ? o.expEv / o.done : 0;
    return o;
  }
  const api = { makeItem, explain, rulePlan, validatePlan, buildPrompt, callGemini, parseJson, judge, parseScore, stats, LAB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHA = api;
})(typeof self !== 'undefined' ? self : this);
