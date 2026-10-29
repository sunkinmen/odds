(function () {
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const DEF = { ver: 2, minOdds: 1.6, minProb: 0.4, kMin: 2, kMax: 4, minJoint: 0.08, rules: '' };
  let cfg = Object.assign({}, DEF, store.get('oh_cfg', {}));
  if (cfg.ver !== 2) { cfg.ver = 2; cfg.minOdds = DEF.minOdds; cfg.minProb = DEF.minProb; cfg.minJoint = DEF.minJoint; store.set('oh_cfg', cfg); }
  let matches = store.get('oh_matches', []);
  let db = null, sortBy = 'ev', analyses = new Map();
  let activeDay = store.get('oh_day', 0);       // 0 今天 1 明天
  let scope = store.get('oh_scope', 'both');    // 0 / 1 / both
  const pct = x => (x * 100).toFixed(0) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WDN = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  let LAB = null;
  const eliteLg = n => /^(英格蘭超級聯賽|德國甲級聯賽|西班牙甲級聯賽|義大利甲級聯賽|法國甲級聯賽)$/.test(n || '') || (/歐洲冠軍|歐洲聯賽|歐霸|世界盃/.test(n || '') && !/皇家足協/.test(n || ''));

  // ---------- 日期(台灣時間) ----------
  const addDay = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wdOf = s => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const days = () => { const t = today(); return [t, addDay(t, 1)]; };
  const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

  function prune() {   // 過期(早於今天)的賽事自動移除
    const t = today(); const n = matches.length;
    matches = matches.filter(m => !m.date || m.date >= t);
    if (matches.length !== n) store.set('oh_matches', matches);
  }
  prune();
  const inDays = m => days().includes(m.date);
  const scoped = () => matches.filter(m => m.date && (scope === 'both' ? inDays(m) : m.date === days()[+scope]));
  const byTime = (a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99'));

  // ---------- 資料庫 ----------
  const SNAPS = store.get('oh_snaps', {});
  let afText = '', afBusy = false, resIdx = null;
  let curData = null;
  function useDb(r) {
    curData = r.data; resIdx = null; db = OH.load(r.data);
    $('dbstat').textContent = `${db.n.toLocaleString()} 場歷史資料 · ${r.custom ? '自訂' : '內建'}`;
    $('dbName').textContent = r.meta.name + (r.meta.at ? `(${r.meta.at} 匯入)` : '');
    $('dbRows').textContent = r.meta.rows.toLocaleString(); $('dbFrom').textContent = r.meta.from.slice(2); $('dbTo').textContent = r.meta.to.slice(2);
    render(); try { renderLog(); } catch (e) { }
    if (!window.__af) { window.__af = 1; setTimeout(() => autoFill(), 1500); }
  }
  OHD.loadActive().then(useDb).catch(e => { $('dbstat').textContent = '歷史資料載入失敗,請重新整理'; console.error(e); });
  $('bSwap').onclick = () => $('file').click();
  $('file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $('swapMsg').textContent = '解析中…(6 萬列約需數秒)';
    try { const r = await OHD.importFile(f); useDb(r); $('swapMsg').textContent = `已更換:${r.meta.rows.toLocaleString()} 場,${r.meta.from} ~ ${r.meta.to}`; }
    catch (err) { $('swapMsg').textContent = '更換失敗:' + err.message; }
    e.target.value = '';
  };
  $('bExport').onclick = async () => { if (!curData) return; $('swapMsg').textContent = '產生 Excel 中…(約 8 萬列,請稍候)'; try { await OHD.exportXlsx(curData); $('swapMsg').textContent = '已下載:欄位同原檔前 11 欄(聯賽~日期)'; } catch (e) { $('swapMsg').textContent = '匯出失敗:' + e.message; } };
  $('bReset').onclick = async () => { await OHD.resetToBuiltin(); useDb(await OHD.loadActive()); $('swapMsg').textContent = '已還原為內建資料'; };

  // ---------- 最低串數 ----------
  function minLegOf(m) {
    if (m.minLeg > 1) return m.minLeg;
    let best = 1;
    cfg.rules.split(/\n+/).forEach(l => {
      const [k, v] = l.split('='); if (!k || !v) return;
      if ((m.league + ' ' + m.id).includes(k.trim())) best = Math.max(best, +v || 1);
    });
    return best;
  }
  function analyzeAll() {
    analyses.clear(); if (!db) return;
    matches.forEach(m => {
      try { const an = OH.analyze(db, m); analyses.set(m.id, { an, pb: OH.pickBest(an, m, cfg.minOdds, cfg.minProb, db) }); } catch (e) { console.warn(e); }
    });
  }

  // ---------- 日期切換列 ----------
  function renderDays() {
    const ds = days();
    $('days').innerHTML = ds.map((d, i) => {
      const n = matches.filter(m => m.date === d).length;
      return `<button class="day ${activeDay === i ? 'on' : ''}" data-i="${i}"><b>${i ? '明天' : '今天'}<em class="cnt">${n} 場</em></b><span>${md(d)} ${WDN[wdOf(d)]}</span></button>`;
    }).join('');
  }
  $('days').onclick = e => { const b = e.target.closest('.day'); if (!b) return; activeDay = +b.dataset.i; store.set('oh_day', activeDay); render(); };

  // ---------- 賽事卡 ----------
  const SHORT = s => String(s || '').replace(/聯賽$/, '').replace(/^國際俱樂部/, '');
  function layerBlock(an) {
    const names = { L1: '① 強隊・相近賠率', L2: '② 同聯賽・相近賠率', L3: '③ 強隊・同星期時段', L4: '④ 弱隊反查' };
    return Object.keys(names).map(k => {
      const L = an.layers[k], n = L.c[0] + L.c[1] + L.c[2];
      if (!n) return `<div class="lay"><span>${names[k]}</span><span class="n">0</span></div>`;
      const f = j => L.c[j] / n * 100;
      return `<div class="lay"><span>${names[k]} <span class="lg">勝${f(0).toFixed(0)}・和${f(1).toFixed(0)}・負${f(2).toFixed(0)}</span></span><span class="n">${n}場</span><div class="sb"><i class="w" style="width:${f(0)}%"></i><i class="d" style="width:${f(1)}%"></i><i class="l" style="width:${f(2)}%"></i></div></div>`;
    }).join('');
  }
  const fmtSc = (an, k) => { const [s, w] = k.split('-'); return an.strongHome ? `客${w}：主${s}` : `客${s}：主${w}`; };
  /* 價值解讀:打平線=1/賠率;樣本誤差用強隊同賠率層的場數估計 */
  function valInfo(c, an) {
    const L = an.layers && an.layers.L1, n = L ? L.c[0] + L.c[1] + L.c[2] : 0;
    const be = 1 / c.odds, d = c.p - c.pm, se = n >= 5 ? 1.96 * Math.sqrt(c.p * (1 - c.p) / n) : 0.1;
    const evTxt = c.ev >= 0 ? '高於本金,模型認為有利' : c.ev > -0.08 ? '小幅偏虧' : '偏虧';
    const small = Math.abs(d) < se;
    const edgeTxt = small ? `與市場差 ${(d * 100).toFixed(1)} 點,小於樣本誤差 ±${(se * 100).toFixed(0)} 點,視同持平` : `${d > 0 ? '高' : '低'}於市場 ${Math.abs(d * 100).toFixed(1)} 點(誤差約 ±${(se * 100).toFixed(0)})`;
    return { be, d, se, evTxt, edgeTxt, small };
  }
  function optBlock(an, m, pb) {
    let h = '<div class="sc3"><h4>挑選投注選項(點選加入「我的選注」)</h4>';
    const bestC = pb.all.slice().sort((x, y) => y.ev - x.ev)[0];
    h += pb.all.map(c => {
      const on = m.pick === c.key, lab = c.key === 'U' ? '小分(總進球≤2)' : c.key === 'O' ? '大分(總進球≥3)' : c.key === 'O35' ? '大3.5(總進球≥4)' : c.key === 'O45' ? '大4.5(總進球≥5)' : `${c.side}(${c.side === '主' ? m.home : c.side === '客' ? m.away : '和局'})`;
      const v = valInfo(c, an), best = c === bestC;
      return `<div class="opt ${on ? 'on' : ''} ${c.ev >= 0 ? 'pos' : ''}" data-k="${c.key}"><span><b>${lab}</b> @${c.odds}${best ? ' <em class="tag">水位後最划算</em>' : ''}</span><span>模型 ${pct(c.p)} <span class="s2">/ 打平線 ${pct(v.be)}</span></span><div class="vbar"><i class="be" style="left:${Math.min(100, v.be * 100)}%"></i><i class="pp" style="width:${Math.min(100, c.p * 100)}%"></i></div><small>每投 100 元平均拿回 <b class="ev">${(100 * (1 + c.ev)).toFixed(0)} 元</b>(${v.evTxt}) ・ 市場認為 ${pct(c.pm)},模型${v.edgeTxt}${c.hist ? ` ・ 同區間歷史報酬 ${(c.hist.roi * 100).toFixed(0)}%` : ''}${on ? ' ・ 已加入' : ''}</small></div>`;
    }).join('');
    return h + '<details class="note"><summary>ⓘ</summary><div class="hint">打平線＝1÷賠率,命中率要超過它才不虧;運彩抽水約 23%,多數選項期望值為負。</div></details></div>';
  }
  function scoreBlock(an, m, pb) {
    const S = an.scoreSum; let h = '<div class="sc3"><h4>⑤ 綜整:最可能的三個比分</h4>';
    if (!S.top.length) h += '<div class="hint">四層都沒有可用樣本,無法統計比分。</div>';
    else {
      h += S.top.map(x => `<div class="scr"><b>${fmtSc(an, x.key)}</b><div class="bar"><i style="width:${Math.min(100, x.p * 100 * 3)}%"></i></div><span>${(x.p * 100).toFixed(0)}%</span><small>出現 ${x.cnt} 次 ・ 母數 ${S.n} 場(四層合計,樣本互有重疊)</small></div>`).join('');
      h += `<div class="hint">比分分布推得:強隊勝${pct(S.pRes[0])}・和${pct(S.pRes[1])}・負${pct(S.pRes[2])}${an.pu ? '' : ''}・總進球≤2 ${pct(S.pUnder)}(共 ${S.uniq} 種比分,單一比分占比通常不高,僅供參考)</div>`;
    }
    h += '<h4 style="margin-top:10px">挑選投注選項(點選加入「我的選注」)</h4>';
    const bestC = pb.all.slice().sort((x, y) => y.ev - x.ev)[0];
    h += pb.all.map(c => {
      const on = m.pick === c.key, lab = c.key === 'U' ? '小分(總進球≤2)' : c.key === 'O' ? '大分(總進球≥3)' : c.key === 'O35' ? '大3.5(總進球≥4)' : c.key === 'O45' ? '大4.5(總進球≥5)' : `${c.side}(${c.side === '主' ? m.home : c.side === '客' ? m.away : '和局'})`;
      const v = valInfo(c, an), best = c === bestC;
      return `<div class="opt ${on ? 'on' : ''} ${c.ev >= 0 ? 'pos' : ''}" data-k="${c.key}"><span><b>${lab}</b> @${c.odds}${best ? ' <em class="tag">水位後最划算</em>' : ''}</span><span>模型 ${pct(c.p)} <span class="s2">/ 打平線 ${pct(v.be)}</span></span><div class="vbar"><i class="be" style="left:${Math.min(100, v.be * 100)}%"></i><i class="pp" style="width:${Math.min(100, c.p * 100)}%"></i></div><small>每投 100 元平均拿回 <b class="ev">${(100 * (1 + c.ev)).toFixed(0)} 元</b>(${v.evTxt}) ・ 市場認為 ${pct(c.pm)},模型${v.edgeTxt}${c.hist ? ` ・ 同區間歷史報酬 ${(c.hist.roi * 100).toFixed(0)}%` : ''}${on ? ' ・ 已加入' : ''}</small></div>`;
    }).join('');
    return h + '<div class="hint">打平線＝1÷賠率(命中率要超過它才不虧);運彩抽水(約 23%)讓多數選項低於 100 元。模型機率已用機器學習校準(2026 樣本外比單純看賠率準,但準確度提升不等於會賺)。比的是「哪個損失最小/優勢最明顯」,回測顯示模型沒有穩定勝過市場,請當作歷史傾向而非保證。</div></div>';
  }
  function ruleBlock(m, an, pb) {
    const it = OHA.makeItem(m, an, pb, { minOdds: cfg.minOdds, minLegOf });
    return `<div class="sc3"><h4>解讀(規則式)<span class="gr ${it.grade}" style="margin-left:6px">${it.grade}</span></h4>${it.reasons.map(r => `<div class="hint" style="margin:3px 0">・${esc(r)}</div>`).join('')}${it.warns.map(r => `<div class="hint" style="margin:3px 0;color:var(--clay)">⚠ ${esc(r)}</div>`).join('')}</div>`;
  }
  function cxHtml(m, a) {
    const cb = a.an.combo, sl = a.an.slot; let h = '';
    if (cb && cb.nLg >= 3) {
      const parts = [], sp = x => x.shr ? x.shr.p : x.share;
      if (cb.hda) parts.push(`${cb.hda.side}${cb.hda.side === '和' ? '' : '勝'} ${pct(sp(cb.hda))}`);
      if (cb.ou) parts.push(`${cb.ou.side}分 ${pct(sp(cb.ou))}`);
      h += `<div class="cx"><b>同聯賽相近賠率</b> ${cb.nLg} 場:${parts.join('・')}</div>`;
    }
    if (sl && sl.top.length && m.weekday != null) h += `<div class="cx"><b>同時段</b> ${sl.n} 場,前三比分:${sl.top.map(t => `客${t.a}:主${t.h}(${t.cnt})`).join('、')}</div>`;
    return h;
  }
  /* ---- 點開後:三組相近賠率常見比分 + 綜整推薦前三 ---- */
  const scLab = x => `客${x.a}：主${x.h}`;
  function srcBlock(title, s, tail) {
    let h = `<div class="sc3"><h4>${title}</h4>`;
    if (!s || !s.n) return h + '<div class="hint">相近賠率下沒有歷史場次。</div></div>';
    h += `<div class="hint" style="margin:0 0 4px">${s.lvl === 0 ? '高度相符' : '大致相符'}${s.win ? `・±${s.win}分` : ''}・${s.n} 場${s.n < 3 ? '(樣本少)' : ''}</div>`;
    h += s.top.map(x => `<div class="scr"><b>${scLab(x)}</b><div class="bar"><i style="width:${Math.min(100, x.cnt / s.n * 100)}%"></i></div><span>${x.cnt} 次</span><small>${pct(x.cnt / s.n)}</small></div>`).join('');
    return h + (tail || '') + '</div>';
  }
  function recBlock(a) {
    const r = a.an.rec; if (!r) return '';
    let h = '<div class="sc3 rec"><h4>綜整推薦比分前三名</h4>';
    h += r.top.map((x, i) => `<div class="scr"><b>${i + 1}. ${scLab(x)}</b><div class="bar"><i style="width:${Math.min(100, x.p * 100 * 4)}%"></i></div><span>${(x.p * 100).toFixed(1)}%</span></div>`).join('');
    return h + `<details class="note"><summary>ⓘ</summary><div class="hint">進球模型(預期進球 主${r.model.lh.toFixed(2)}・客${r.model.la.toFixed(2)})加歷史比分調整;純模型前三:${r.modelTop.map(x => scLab(x) + ' ' + (x.p * 100).toFixed(1) + '%').join('、')}</div></details></div>`;
  }
  const MEDAL = [['gold', '金牌'], ['silver', '銀牌'], ['bronze', '銅牌']];
  function card(m, medal, rank, hp) {
    const a = analyses.get(m.id); let cls = '', verdict = '', det = '';
    let hit = null;
    if (!db) verdict = '<span class="tag plain">等待資料庫…</span>';
    else if (a) {
      const { an, pb } = a, b = pb.best; hit = b;
      const unk = [an.resolved.home, an.resolved.away].some(x => x.id < 0);
      const lab = c => c.key === 'U' ? '小分' : c.key === 'O' ? '大分' : c.side;
      if (b) {
        cls = b.anom ? 'pick' : '';
        verdict = `<span class="tag">建議 ${lab(b)} @${b.odds}${b.anom ? '・異常' : ''}</span>${pb.alt ? `<span class="tag plain">另 ${lab(pb.alt)} @${pb.alt.odds}</span>` : ''}`;
        { const mv = OHT.movement(SNAPS, m, b.key); if (mv) verdict += `<span class="mv ${mv.pct < 0 ? 'dn' : 'up'}" title="賠率變動:${mv.open} → ${mv.now}(共 ${mv.n} 次紀錄)">${mv.pct < 0 ? '▼' : '▲'}${mv.open}→${mv.now}</span>`; }
        if (minLegOf(m) > 1) verdict += `<span class="tag plain">${minLegOf(m)}串起</span>`;
      }
      verdict += cxHtml(m, a);
      (an.tail || []).filter(t => t.flag).forEach(t => { verdict += `<span class="tag flag" title="比分分布與大小盤估算">高比分 大${t.line} 偏高 ${pct(t.p)}(市場${pct(t.pm)}) @${t.odds}</span>`; });
      if (unk) verdict += '<span class="tag plain">部分隊名查無歷史</span>';
      det = `<div class="det">${srcBlock(`① ${esc(m.home)} 主場常見比分`, an.rec && an.rec.src.home)}${srcBlock(`② ${esc(m.away)} 客場常見比分`, an.rec && an.rec.src.away)}${srcBlock(`③ 同聯賽同時段(${WDN[m.weekday] || ''} ${esc(m.time || '')})常見比分`, an.rec && an.rec.src.slot)}${recBlock(a)}${optBlock(an, m, pb)}
        <div class="row" style="margin:8px 0 2px"><span class="hint" style="margin:0 0 0 6px">最低串數</span><select class="ml" style="width:auto;padding:6px 10px">${[0, 2, 3, 4, 5].map(v => `<option value="${v}" ${(m.minLeg || 0) === v ? 'selected' : ''}>${v ? v + ' 串起' : '依規則'}</option>`).join('')}</select><span class="grow"></span><button class="btn line sm del">刪除</button></div></div>`;
    }
    const pk = hit && hit.market === '勝平負' ? hit.side : null, pu = hit && hit.key === 'U', po = hit && hit.key === 'O';
    const ex = (a && a.an.resolved.league) || '';
    const f1 = a ? a.pb.t1 : null, f2 = a ? a.pb.t2 : null;   // 鎖定邏輯:每場兩個市場各自的最佳選項(虛線框),建議(實心)必為其中之一
    const fv = (cond) => cond ? ' fav' : '';
    return `<article class="match ${cls}${medal != null ? ' medal ' + MEDAL[medal][0] : ''}" data-id="${esc(m.id)}">${medal != null ? `<span class="mbadge">${MEDAL[medal][1]} · 今日第 ${medal + 1} 名</span>` : ''}
      <div class="mt"><b>${esc(m.time || '--:--')}</b><span>${esc(SHORT(m.league || ex))}</span>${rank != null ? `<i class="rk">#${rank + 1}</i>` : ''}</div>
      <div><div class="teams">${esc(m.away)}<span class="at">@</span>${esc(m.home)}</div>
        <div class="odds"><div class="o ${pk === '客' ? 'hit' : ''}${fv(f1 && f1.side === '客')}"><i>客</i>${m.oa}</div><div class="o ${pk === '和' ? 'hit' : ''}${fv(f1 && f1.side === '和')}"><i>和</i>${m.od}</div><div class="o ${pk === '主' ? 'hit' : ''}${fv(f1 && f1.side === '主')}"><i>主</i>${m.oh}</div>${m.ou ? `<div class="o u ${pu ? 'hit' : ''}${fv(f2 && f2.key === 'U')}"><i>小</i>${m.ou}</div>` : '<div></div>'}${m.ov ? `<div class="o u ${po ? 'hit' : ''}${fv(f2 && f2.key === 'O')}"><i>大</i>${m.ov}</div>` : '<div></div>'}</div>
        <div class="verdict">${hp ? `<span class="tag">高賠首選 ${hp.key === 'U' ? '小分' : hp.key === 'O' ? '大分' : hp.side} @${hp.odds}${hp.cx && hp.cx.src === 'league' ? `・同聯賽 ${pct(hp.cx.share)}` : '・市場熱門'}</span>` : ''}${verdict}</div></div>${det}</article>`;
  }
  const EMPTY = '<div class="empty"><svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17"/></svg><div>這天還沒有賽事</div><div class="hint">用上方「貼上匯入 / 連線抓取 / 手動新增」加入運彩賽事</div></div>';
  /* 排序:最佳=規則評等 A>B>C 再比扣水後期望值(前三名拿金銀銅);高賠=在達到最低賠率與機率的選項中,賠率最高者優先,同賠率比機率。沒有可建議選項的場次排在最後,依開賽時間。 */
  let sortMode = store.get('oh_sort', 'best');
    function highPick(a) { const ok = [a.pb.t1, a.pb.t2].filter(c => c && c.odds >= cfg.minOdds && (c.conf || 0) >= 0.5).sort((x, y) => y.odds - x.odds || (y.conf - x.conf)); return ok[0] || null; }
  /* 最佳排序(鎖定邏輯):只排有建議的場次——先比「樣本少且高度集中」的層級(樣本<=15 且集中度>=85% 最前,再來 <=30 場且>=70%),
     同層級先看賠率組合是否集中在同一聯賽(同聯賽占全聯賽>=60%),再比集中度、樣本數少者在前。前三名拿金銀銅。 */
  function orderList(list) {
    const keyed = [], rest = [], info = new Map(), tiers = new Map();
    list.forEach(m => {
      const a = analyses.get(m.id); let s = null;
      if (a) {
        if (sortMode === 'high') { const h = highPick(a); if (h) { s = [-h.odds, -(h.conf || 0)]; info.set(m.id, h); } }
        else if (a.pb.best) { const b = a.pb.best, cb = a.an.combo; s = b.cx ? [OH.tierOf(b.cx.n, b.cx.share), cb.lgShare >= 0.6 ? 0 : 1, -b.cx.share, b.cx.n] : [3, 1, -b.conf, 0]; tiers.set(m.id, s[0]); }
      }
      (s ? keyed : rest).push({ m, s });
    });
    const cmp = (x, y) => { for (let i = 0; i < x.s.length; i++) if (x.s[i] !== y.s[i]) return x.s[i] - y.s[i]; return byTime(x.m, y.m); };
    keyed.sort(cmp);
    rest.sort((x, y) => byTime(x.m, y.m));
    const ranks = new Map(); keyed.forEach((x, i) => ranks.set(x.m.id, i));
    return { list: keyed.concat(rest).map(x => x.m), ranks, info, tiers };
  }
  function render() {
    prune(); analyzeAll(); renderDays();
    const d = days()[activeDay]; let list = matches.filter(m => m.date === d).sort(byTime);
    const od = orderList(list); list = od.list;
    document.querySelectorAll('#sortBar button').forEach(b => b.classList.toggle('on', b.dataset.m === sortMode));
    $('list').innerHTML = list.length ? list.map(m => { const r = od.ranks.get(m.id); return card(m, sortMode === 'best' && r != null && r < 3 && (od.tiers.get(m.id) <= 1) ? r : null, r, od.info.get(m.id)); }).join('') : EMPTY;
    $('anomMsg').innerHTML = '';
    const other = matches.filter(m => !inDays(m)).length;
    $('skipMsg').textContent = other ? `另有 ${other} 場今明兩天以外的賽事已略過(後天的賽事通常還沒開賣)` : '';
    renderScope(); renderMine(); renderParlay();
  }
  $('sortBar').onclick = e => { const b = e.target.closest('button'); if (!b) return; sortMode = b.dataset.m; store.set('oh_sort', sortMode); render(); };
  $('list').addEventListener('click', e => {
    const c = e.target.closest('.match'); if (!c) return; const id = c.dataset.id;
    if (e.target.classList.contains('del')) { matches = matches.filter(x => x.id !== id); store.set('oh_matches', matches); render(); return; }
    if (e.target.closest('select,input')) return;
    const op = e.target.closest('.opt');
    if (op) { const m = matches.find(x => x.id === id); m.pick = m.pick === op.dataset.k ? '' : op.dataset.k; if (m.pick) m.inc = true; store.set('oh_matches', matches); const was = c.classList.contains('open'); render(); if (was) { const n = document.querySelector(`.match[data-id="${CSS.escape(id)}"]`); if (n) n.classList.add('open'); } return; }
    if (e.target.closest('.det')) return;
    c.classList.toggle('open');
  });
  $('list').addEventListener('change', e => {
    if (e.target.classList.contains('ov-in')) { const m = matches.find(x => x.id === e.target.closest('.match').dataset.id); m.ov = +e.target.value > 1 ? +e.target.value : 0; store.set('oh_matches', matches); render(); return; }
    if (e.target.classList.contains('ou-in')) { const m = matches.find(x => x.id === e.target.closest('.match').dataset.id); m.ou = +e.target.value > 1 ? +e.target.value : 0; store.set('oh_matches', matches); render(); return; }
    if (!e.target.classList.contains('ml')) return;
    const id = e.target.closest('.match').dataset.id, m = matches.find(x => x.id === id); m.minLeg = +e.target.value; store.set('oh_matches', matches); render();
  });

  // ---------- 串關 ----------
  function renderScope() {
    const ds = days(), opts = [['0', `今天 ${md(ds[0])}`], ['1', `明天 ${md(ds[1])}`], ['both', '今明兩天']];
    $('scope').innerHTML = opts.map(([v, t]) => `<button class="chp ${String(scope) === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('');
  }
  $('scope').onclick = e => { const b = e.target.closest('.chp'); if (!b) return; scope = b.dataset.v; store.set('oh_scope', scope); renderScope(); renderMine(); renderParlay(); };
  function renderParlay() {
    if (!db) return;
    const legs = [], inScope = scoped();
    inScope.forEach(m => {
      const a = analyses.get(m.id); if (!a || !a.pb.best) return; const b = a.pb.best;
      legs.push({ id: m.id, label: `${m.away} @ ${m.home}`, pick: (b.key === 'U' ? '小分' : b.key === 'O' ? '大分' : b.side), tm: `${md(m.date)} ${m.time || ''}`, odds: b.odds, p: b.p, minLeg: minLegOf(m) });
    });
    const r = OHP.recommend(legs, { ...cfg, sortBy });
    $('pInfo').textContent = `${inScope.length} 場 → 合格 ${r.pool.length} 場`;
    if (!r.picks.length) { $('parlays').innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z"/><path d="m4 12.5 8 4.5 8-4.5"/></svg><div>目前沒有符合條件的串關</div><div class="hint">合格 ${r.pool.length} 場(賠率 ≥ ${cfg.minOdds}、機率 ≥ ${pct(cfg.minProb)})。可到設定放寬,或匯入更多賽事。</div></div>`; return; }
    $('parlays').innerHTML = r.picks.map((p, i) => `<div class="ticket"><div class="hd"><div style="display:flex;align-items:center"><span class="rank">${i + 1}</span><div><div class="k">${p.k} 串 1${p.need > 1 ? `・限${p.need}串起` : ''}</div><div class="big">${p.odds.toFixed(2)}<small>總賠率</small></div></div></div><div style="text-align:right"><div class="k">命中機率</div><div class="big">${pct(p.p)}</div></div></div><div class="perf"></div>
      <div class="legs">${p.legs.map(l => `<div class="leg"><div><div>${esc(l.label)}</div><div class="tm">${esc(l.tm)}</div></div><div class="pk">${esc(l.pick)} <span style="font-weight:500;color:var(--mute)">@${l.odds}</span></div></div>`).join('')}</div>
      <div class="ft"><span class="tag ${p.ev < 0 ? 'skip' : ''}">期望 ${(p.ev * 100).toFixed(0)}%</span><span class="tag plain">每 100 元約回 ${(100 * p.p * p.odds).toFixed(0)} 元</span></div></div>`).join('') +
      `<div class="hint" style="text-align:center;margin:12px 6px">期望值 = 命中機率 × 總賠率 − 1,幾乎都是負值,只用來比較組合之間的相對好壞。</div>`;
  }
  // ---------- 我的選注・系統串關 ----------
  let sysType = store.get('oh_sys', ''), stake = store.get('oh_stake', 100);
  function myLegs() {
    const out = [];
    scoped().sort(byTime).forEach(m => {
      if (!m.pick) return; const a = analyses.get(m.id); if (!a) return; const c = a.pb.all.find(x => x.key === m.pick); if (!c) return;
      out.push({ id: m.id, m, label: `${m.away} @ ${m.home}`, pick: (c.key === 'U' ? '小分' : c.key === 'O' ? '大分' : c.side), odds: c.odds, p: c.p, minLeg: minLegOf(m), inc: m.inc !== false });
    });
    return out;
  }
  function renderMine() {
    const el = $('mine'); if (!db) { el.innerHTML = ''; return; }
    const all = myLegs();
    if (!all.length) { el.innerHTML = '<div class="hint" style="margin:0">尚未選注。到「賽事」頁展開賽事卡,在「挑選投注選項」點選要串的選項;或'+'<button class="btn sm alt" id="mAuto">自動帶入各場最佳選項</button></div>'; return; }
    const legs = all.filter(l => l.inc), N = legs.length;
    let h = all.map((l, i) => `<div class="mleg"><input type="checkbox" data-id="${esc(l.id)}" ${l.inc ? 'checked' : ''}><label>${esc(l.label)}<div class="tm hint" style="margin:0">${esc(l.m.time || '')} ・ ${l.pick} @${l.odds} ・ 機率${pct(l.p)}${l.minLeg > 1 ? ` ・ ${l.minLeg}串起` : ''}</div></label><button class="btn line sm" data-rm="${esc(l.id)}">移除</button></div>`).join('');
    h += `<div class="row" style="margin-top:10px"><span class="hint" style="margin:0">已勾選 ${N} 場</span><span class="grow"></span><button class="btn sm line" id="mClr">全部清除</button><button class="btn sm alt" id="mAuto">自動帶入</button></div>`;
    if (N < 2) { el.innerHTML = h + '<div class="hint">至少勾選 2 場才能串關。</div>'; return; }
    if (N > 8) { el.innerHTML = h + '<div class="hint">系統串關最多 8 場,請取消部分勾選。</div>'; return; }
    const types = OHP.SYS[N] || [];
    if (!types.some(t => t[0] === sysType)) sysType = types[0][0];
    h += `<div class="hint" style="margin-top:12px">${N} 場常見串關(點選直接計算)</div><div class="tbtn">${types.map(t => `<button class="chp ${t[0] === sysType ? 'on' : ''}" data-t="${t[0]}">${t[0]}</button>`).join('')}</div>`;
    const sizes = types.find(t => t[0] === sysType)[1], r = OHP.calcSystem(legs, sizes, stake);
    const M = sysType.split('串'), x = sysType.replace('串', 'x');
    h += `<div class="row" style="margin-top:6px"><span class="hint" style="margin:0">每注金額</span><input id="stk" inputmode="numeric" style="width:90px;padding:6px 10px" value="${stake}"><span class="hint" style="margin:0">元(共 ${r.bets} 注)</span></div>
      <div class="kv"><span>${sysType}(${x}):${sizes.map(k => k + '串1').join('＋')}</span><b>${r.bets} 注</b><span>投注總額</span><b>${r.cost.toLocaleString()} 元</b><span>全部命中時回收</span><b>${Math.round(r.maxRet).toLocaleString()} 元</b><span>至少中一注的機率</span><b>${pct(r.pAny)}</b><span>回本(回收≥投注)機率</span><b>${pct(r.pBreak)}</b><span>期望回收(模型)</span><b>${Math.round(r.expRet).toLocaleString()} 元</b><span>期望值</span><b style="color:${r.ev < 0 ? 'var(--clay)' : 'var(--deep)'}">${(r.ev * 100).toFixed(0)}%</b></div>`;
    if (r.bad) h += `<div class="hint">有 ${r.bad} 個組合因含「${Math.max(...legs.map(l => l.minLeg))}串起」的賽事而不合規,已排除不計。</div>`;
    if (!r.bets) h += '<div class="hint">此型態沒有合規組合,請換一種或調整最低串數。</div>';
    h += '<div class="hint">假設各場獨立、機率取自模型;期望值多為負,系統串關只是降低「全中才有」的門檻,並不會提高期望值。</div>';
    el.innerHTML = h;
  }
  $('mine').addEventListener('click', e => {
    const t = e.target.closest('[data-t]'); if (t) { sysType = t.dataset.t; store.set('oh_sys', sysType); renderMine(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { const m = matches.find(x => x.id === rm.dataset.rm); if (m) m.pick = ''; store.set('oh_matches', matches); render(); return; }
    if (e.target.id === 'mClr') { scoped().forEach(m => m.pick = ''); store.set('oh_matches', matches); render(); return; }
    if (e.target.id === 'mAuto') { scoped().forEach(m => { const a = analyses.get(m.id); if (a && a.pb.best) { m.pick = a.pb.best.key; m.inc = true; } }); store.set('oh_matches', matches); render(); }
  });
  $('mine').addEventListener('change', e => {
    if (e.target.type === 'checkbox') { const m = matches.find(x => x.id === e.target.dataset.id); if (m) m.inc = e.target.checked; store.set('oh_matches', matches); renderMine(); }
    if (e.target.id === 'stk') { stake = Math.max(1, +e.target.value || 100); store.set('oh_stake', stake); renderMine(); }
  });
  const setSort = s => { sortBy = s; $('sEv').classList.toggle('on', s === 'ev'); $('sP').classList.toggle('on', s === 'p'); renderParlay(); };
  $('sEv').onclick = () => setSort('ev'); $('sP').onclick = () => setSort('p');

  // ---------- 匯入 ----------
  function stamp(m) {     // 沒有日期的歸入目前選的那天
    if (!m.date) { m.date = days()[activeDay]; m.weekday = wdOf(m.date); if (m.time && m.minutes == null) m.minutes = +m.time.slice(0, 2) * 60 + +m.time.slice(3, 5); }
    return m;
  }
  function addMatches(arr) {
    let added = 0, drop = 0; const t = today();
    arr.forEach(m => {
      stamp(m); if (m.date < t) { drop++; return; }
      if (!m.id) m.id = 'X' + Math.random().toString(36).slice(2, 7);
      const i = matches.findIndex(x => x.date === m.date && ((x.id === m.id && x.home === m.home) || (x.home === m.home && x.away === m.away)));
      if (i >= 0) { m.minLeg = m.minLeg || matches[i].minLeg; if (!m.ou && matches[i].ou) m.ou = matches[i].ou; if (!m.ov && matches[i].ov) m.ov = matches[i].ov; if (matches[i].pick) { m.pick = matches[i].pick; m.inc = matches[i].inc; } matches[i] = m; } else { matches.push(m); added++; }
    });
    try { if (OHT.record(SNAPS, arr.filter(m => m.date >= t), Date.now())) store.set('oh_snaps', SNAPS); } catch (e) { }
    store.set('oh_matches', matches); render();
    $('impMsg').textContent = `匯入 ${arr.length - drop} 場(新增 ${added})${drop ? `,略過已過期 ${drop} 場` : ''}`;
  }
  const show = id => ['importBox', 'addBox', 'helpBox'].forEach(x => { const el = $(x); el.style.display = x === id && el.style.display === 'none' ? 'block' : 'none'; });
  $('bPaste').onclick = () => show('importBox'); $('bAdd').onclick = () => show('addBox');
  $('bDo').onclick = () => { const a = OHI.parse($('txt').value, { today: today() }); if (a.length) { addMatches(a); $('txt').value = ''; } else { const L = $('txt').value.split(/\n/).filter(x => x.trim()); $('impMsg').textContent = L.length ? `解析不到賽事。收到 ${L.length} 行,前 15 行:\n` + L.slice(0, 15).join(' | ') : '沒有內容可匯入(剪貼簿是空的,或書籤沒有執行)'; } };
  $('bClip').onclick = async () => { try { $('txt').value = await navigator.clipboard.readText(); $('bDo').click(); } catch (e) { $('impMsg').textContent = '無法讀取剪貼簿,請在上方框內長按「貼上」後再按匯入'; } };
  $('bClear').onclick = () => { if (confirm('清空所有賽事?')) { matches = []; store.set('oh_matches', matches); render(); } };
  $('aSave').onclick = () => {
    const m = { id: 'M' + Date.now(), league: $('aLeague').value.trim(), home: $('aHome').value.trim(), away: $('aAway').value.trim(), oh: +$('aH').value, od: +$('aD').value, oa: +$('aA').value, ou: +$('aU').value || 0, minLeg: 0 };
    if (!m.home || !m.away || !(m.oh > 1 && m.od > 1 && m.oa > 1)) { $('impMsg').textContent = '請填主客隊與三項賠率(>1)'; return; }
    const t = $('aT').value; if (t) { m.time = t; m.minutes = +t.slice(0, 2) * 60 + +t.slice(3, 5); }
    addMatches([m]); ['aHome', 'aAway', 'aH', 'aD', 'aA', 'aU'].forEach(k => $(k).value = '');
  };
  $('bHelp').onclick = () => show('helpBox');

  // ---------- 設定 ----------
  function fillCfg() { $('sMinOdds').value = cfg.minOdds; $('sMinProb').value = cfg.minProb; $('sKMin').value = cfg.kMin; $('sKMax').value = cfg.kMax; $('sMinJoint').value = cfg.minJoint; $('sRules').value = cfg.rules; }
  $('sSave').onclick = () => {
    cfg = { ver: 2, minOdds: +$('sMinOdds').value || 1.3, minProb: +$('sMinProb').value || 0.5, kMin: Math.max(2, +$('sKMin').value || 2), kMax: Math.min(8, +$('sKMax').value || 4), minJoint: +$('sMinJoint').value || 0.12, rules: $('sRules').value };
    store.set('oh_cfg', cfg); render(); alert('已儲存');
  };
  fillCfg();
  function bm() {
    var PWA = '__PWA__';
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:#4f5f52;color:#fff;padding:10px 12px;border-radius:10px;font:14px/1.5 sans-serif;word-break:break-all';
    bar.textContent = '賠率獵人:抓取中…'; document.body.appendChild(bar);
    var say = function (t, ms) { bar.textContent = t; if (ms) setTimeout(function () { bar.remove(); }, ms); };
    (async function () {
      try {
        var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        var frames = [], shadows = 0;
        var txt = function () {
          var r = []; frames = []; shadows = 0;
          var walk = function (n) {
            if (n.nodeType === 3) { var p = n.parentElement; if (p && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) && !bar.contains(p)) { var s = n.nodeValue.replace(/\s+/g, ' ').trim(); if (s) r.push(s); } return; }
            if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
            if (n === bar) return;
            if (n.nodeType === 1) {
              if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.tagName)) return;
              if (n.tagName === 'IFRAME') { var d = null; try { d = n.contentDocument; } catch (e) { } if (d && d.body) walk(d.body); else if (n.src) frames.push(n.src); return; }
              if (n.shadowRoot) { shadows++; walk(n.shadowRoot); }
            }
            for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
          };
          walk(document.body); return r.join('\n');
        };
        var root = function () { return document.scrollingElement || document.body; };
        var grab = async function () { var h = 0; for (var i = 0; i < 12; i++) { root().scrollTo(0, root().scrollHeight); await sleep(350); if (root().scrollHeight === h) break; h = root().scrollHeight; } root().scrollTo(0, 0); return txt(); };
        var find = function (re) { return Array.prototype.filter.call(document.querySelectorAll('button,a,div,span,li,p'), function (e) { return e.children.length <= 1 && re.test((e.innerText || '').trim()); }); };
        var scan = function () {
          var els = Array.prototype.slice.call(document.querySelectorAll('[aria-label*="odds"]')), rows = new Map(), res = [];
          els.forEach(function (el) {
            var m = (el.getAttribute('aria-label') || '').match(/^([\s\S]+?)\s*-\s*([\s\S]+?)\s*-\s*odds\s*([\d.]+)\s*$/i); if (!m) return;
            var c = el, r = null; for (var i = 0; i < 20 && c; i++) { if (c.querySelector && c.querySelector('[data-test-id="chip-event-header"]')) { r = c; break; } c = c.parentElement; }
            if (!r) return;
            if (!rows.has(r)) { var lb = r.querySelector('[data-test-id="chip-event-header"] label'); rows.set(r, { id: lb ? lb.textContent.trim() : '', t: (r.textContent || '').replace(/\s+/g, ' '), mk: {} }); }
            var d = rows.get(r); (d.mk[m[1].trim()] = d.mk[m[1].trim()] || []).push({ s: m[2].trim(), o: parseFloat(m[3]) });
          });
          var now = new Date();
          rows.forEach(function (d) {
            var ml = null, u = 0;
            Object.keys(d.mk).forEach(function (k) { var s = d.mk[k]; if (s.some(function (x) { return x.s === '和局'; })) ml = s; var us = s.filter(function (x) { return x.s.indexOf('小') >= 0; })[0]; if (us) u = us.o; });
            if (!ml || !d.id) return;
            var dr = ml.filter(function (x) { return x.s === '和局'; })[0], t = ml.filter(function (x) { return x.s !== '和局'; });
            if (!dr || t.length < 2) return;
            var dm = d.t.match(/(\d{1,2})\s*(\d{1,2})月/), tm = d.t.match(/(\d{1,2}):(\d{2})/), md = '';
            if (dm && tm) { var y = now.getFullYear(), mo = +dm[2], dd = +dm[1], cand = new Date(y, mo - 1, dd), diff = (cand - now) / 864e5; if (diff < -200) y++; else if (diff > 200) y--; md = y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd + ' ' + (tm[1].length < 2 ? '0' : '') + tm[1] + ':' + tm[2]; }
            res.push({ matchId: d.id, awayTeam: t[0].s, oddsAway: t[0].o, homeTeam: t[1].s, oddsHome: t[1].o, oddsDraw: dr.o, oddsUnder: u || null, matchDate: md });
          });
          return res;
        };
        var merge = function (A, B) { var seen = {}; return A.concat(B).filter(function (m) { var k = m.matchId + '|' + m.matchDate; if (seen[k]) return false; seen[k] = 1; return true; }); };
        var out = await grab(), got = scan();
        var hasRows = got.length > 0 || /\d{1,2}\s*\d{1,2}\s*月/.test(out) && (out.match(/\b\d{1,3}\.\d{2}\b/g) || []).length >= 6;
        if (!hasRows) {
          bar.remove(); var w = document.createElement('div'); w.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;color:#222;padding:14px;overflow:auto;font:14px/1.6 sans-serif';
          if (frames.length === 1) { say('賽事表在框架裡,正在開啟…開啟後請再按一次書籤'); setTimeout(function () { location.href = frames[0]; }, 1200); return; }
          var h = '<b>這一層頁面沒有賽事</b><div style="margin:6px 0">共 ' + out.split('\n').length + ' 行文字;內嵌框架 ' + frames.length + ' 個;shadow 節點 ' + shadows + ' 個。</div>';
          if (frames.length) { h += '<div>賽事表在另一個網頁框架裡,書籤不能直接讀取。請點下面的網址在此分頁開啟,<b>開啟後再按一次書籤</b>:</div>'; frames.forEach(function (u) { h += '<p style="word-break:break-all"><a href="' + u.replace(/"/g, '&quot;') + '" target="_top" style="color:#06c">' + u.replace(/</g, '&lt;') + '</a></p>'; }); }
          h += '<div style="margin-top:10px"><button id="ohx" style="padding:12px 16px;font-size:15px">關閉</button> <button id="ohc" style="padding:12px 16px;font-size:15px">複製這份報告</button></div>';
          w.innerHTML = h; document.body.appendChild(w);
          var rep = '頁面報告\nURL: ' + location.href + '\n框架: ' + frames.join(' ; ') + '\nshadow: ' + shadows + '\n文字行數: ' + out.split('\n').length;
          w.querySelector('#ohx').onclick = function () { w.remove(); };
          w.querySelector('#ohc').onclick = function () { var t = document.createElement('textarea'); t.value = rep; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { } t.remove(); };
          return;
        }
        var msg = '只抓到目前畫面(沒找到明天分頁)';
        var nx = find(/^星期[一二三四五六日]\s*\d{1,2},\s*\d{1,2}$/)[0];
        if (nx) { var before = out; say('賠率獵人:切換到明天…'); nx.click(); for (var i = 0; i < 14; i++) { await sleep(500); if (i >= 2 && txt() !== before) break; } out += '\n' + await grab(); got = merge(got, scan()); msg = '今天+明天'; var td = find(/^今天$/)[0]; if (td) td.click(); }
        if (got.length && PWA) { var pl = btoa(unescape(encodeURIComponent(JSON.stringify(got.map(function (m) { return [m.matchId, m.awayTeam, m.oddsAway, m.homeTeam, m.oddsHome, m.oddsDraw, m.oddsUnder, m.matchDate]; }))))); say('已抓到 ' + got.length + ' 場,正在回到賠率獵人…'); try { navigator.clipboard.writeText(JSON.stringify(got)); } catch (e) { } location.href = PWA + '#oh=' + pl.replace(/\+/g, '-').replace(/\//g, '_'); return; }
        if (got.length) { out = JSON.stringify(got); msg += ',' + got.length + ' 場'; }
        var lines = got.length || out.split('\n').length;
        var manual = function () {
          bar.remove(); var w2 = document.createElement('div'); w2.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;padding:12px;display:flex;flex-direction:column;gap:8px';
          var t = document.createElement('textarea'); t.value = out; t.style.cssText = 'flex:1;width:100%;font-size:12px';
          var b = document.createElement('button'); b.textContent = '複製全部並關閉(' + lines + ')'; b.style.cssText = 'padding:14px;font-size:16px';
          b.onclick = function () { t.select(); try { document.execCommand('copy'); } catch (e) { } w2.remove(); }; w2.appendChild(t); w2.appendChild(b); document.body.appendChild(w2);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) { try { await navigator.clipboard.writeText(out); say('已複製 ' + lines + (got.length ? ' 場' : ' 行') + '(' + msg + '),回到賠率獵人按「貼上匯入」', 6000); } catch (e) { manual(); } } else manual();
      } catch (e) { say('抓取失敗:' + (e && e.message)); }
    })();
  }
  const bmSrc = 'javascript:(' + bm.toString().replace('__PWA__', location.origin + location.pathname).replace(/\s*\n\s*/g, '') + ')()';
  $('bm').textContent = bmSrc;
  $('bmCopy').onclick = () => navigator.clipboard.writeText(bmSrc).then(() => alert('已複製'), () => alert('請長按選取文字複製'));

  // ---------- AI 顧問 ----------
  let gem = Object.assign({ key: '', model: '', search: false, models: [] }, store.get('oh_gem', {}));
  let budget = store.get('oh_budget', 1000), curPlan = null, curItems = [];
  let LOG = store.get('oh_log', []), PLANS = store.get('oh_plans', []), SCORES = store.get('oh_scores', {});
  const saveLog = () => { store.set('oh_log', LOG); store.set('oh_plans', PLANS); store.set('oh_scores', SCORES); };
  const SYSNAMES = () => { const o = {}; Object.keys(OHP.SYS).forEach(n => { if (n >= 2 && n <= 6) o[n] = OHP.SYS[n].map(t => t[0]); }); return o; };
  const aiOpts = () => ({ budget, minOdds: cfg.minOdds, minProb: cfg.minProb, SYS: OHP.SYS, calc: OHP.calcSystem });
  function buildItems() {
    if (!db) return [];
    return scoped().sort(byTime).map(m => { const a = analyses.get(m.id); return a ? OHA.makeItem(m, a.an, a.pb, { minOdds: cfg.minOdds, minLegOf }) : null; }).filter(Boolean);
  }
  const itOf = id => curItems.find(i => i.id === id);
  const candOf = (id, k) => { const i = itOf(id); return i && i.cands.find(c => c.k === k); };
  function planStats(plan) {
    let cost = 0, exp = 0, maxRet = 0;
    plan.singles.forEach(s => { const c = candOf(s.id, s.k); cost += s.stake; exp += s.stake * c.p * c.odds; maxRet += s.stake * c.odds; });
    let pr = null;
    if (plan.parlay) {
      const L = plan.parlay.legs.map(l => { const i = itOf(l.id), c = candOf(l.id, l.k); return { odds: c.odds, p: c.p, minLeg: i.minLeg || 1 }; });
      const t = OHP.SYS[L.length].find(x => x[0] === plan.parlay.type); pr = OHP.calcSystem(L, t[1], plan.parlay.stakePer);
      cost += pr.cost; exp += pr.expRet; maxRet += pr.maxRet;
    }
    return { cost, exp, maxRet, ev: cost ? exp / cost - 1 : 0, pr };
  }
  function renderPlan() {
    const el = $('aiOut'); if (!curPlan) { el.innerHTML = ''; return; }
    const p = curPlan, st = planStats(p), L = k => OHA.LAB[k];
    let h = `<div class="plan"><h4>${p.src === 'ai' ? 'Gemini 方案' : '規則方案'}</h4><div>${esc(p.summary)}</div></div>`;
    if (p.singles.length) h += `<div class="plan"><h4>單場</h4>${p.singles.map(s => { const i = itOf(s.id), c = candOf(s.id, s.k); return `<div class="pl"><span><span class="gr ${i.grade}">${i.grade}</span>${esc(i.label)}<br><b>${L(s.k)}</b> @${c.odds}・機率${pct(c.p)}・期望${(c.ev * 100).toFixed(0)}%</span><b>${s.stake} 元</b><div class="rs">${esc(s.reason)}${p.news && p.news[s.id] ? `<br>消息:${esc(p.news[s.id])}` : ''}</div></div>`; }).join('')}</div>`;
    if (p.parlay && st.pr) { const r = st.pr; h += `<div class="plan"><h4>系統串關 ${esc(p.parlay.type)}(${r.bets} 注 × ${p.parlay.stakePer} 元)</h4>${p.parlay.legs.map(l => { const i = itOf(l.id), c = candOf(l.id, l.k); return `<div class="pl"><span>${esc(i.label)}<br><b>${L(l.k)}</b> @${c.odds}・機率${pct(c.p)}</span><b>${i.minLeg > 1 ? i.minLeg + '串起' : ''}</b></div>`; }).join('')}<div class="rs">${esc(p.parlay.reason)}。全中回收 ${Math.round(r.maxRet).toLocaleString()} 元・至少中一注 ${pct(r.pAny)}・回本機率 ${pct(r.pBreak)}</div></div>`; }
    if (!p.singles.length && !p.parlay) h += '<div class="plan"><div>今天沒有建議投注的方案。</div></div>';
    h += `<div class="plan"><h4>合計</h4><div class="pl"><span>投入</span><b>${st.cost.toLocaleString()} 元(預算 ${budget})</b><span>模型期望回收</span><b>${Math.round(st.exp).toLocaleString()} 元</b><span>期望值</span><b style="color:${st.ev < 0 ? 'var(--clay)' : 'var(--deep)'}">${(st.ev * 100).toFixed(0)}%</b></div></div>`;
    if (p.risks && p.risks.length) h += `<div class="plan"><h4>風險</h4>${p.risks.map(r => `<div class="rs">・${esc(r)}</div>`).join('')}</div>`;
    if (p.issues && p.issues.length) h += `<div class="hint">已自動修正:${p.issues.map(esc).join(';')}</div>`;
    if (p.skips && p.skips.length) h += `<details class="note" style="margin-top:6px"><summary>略過的場次(${p.skips.length})</summary>${p.skips.map(s => { const i = itOf(s.id); return `<div class="rs" style="font-size:12.5px;color:var(--mute)">・${esc(i ? i.label : s.id)}:${esc(s.reason)}</div>`; }).join('')}</details>`;
    h += riskHtml(p, st);
    h += `<div class="row" style="margin-top:10px"><button class="btn" id="planAdopt" ${(p.singles.length || p.parlay) ? '' : 'disabled'}>採用並記錄</button><span class="hint" style="margin:0">記錄後可在下方填入比分,驗證推薦準不準</span></div>`;
    el.innerHTML = h;
  }
  function setPlan(plan) { curPlan = OHA.validatePlan(plan, curItems, aiOpts()); renderPlan(); }
  function prepare() {
    if (!db) { $('aiOut').innerHTML = '<div class="hint">歷史資料載入中…</div>'; return false; }
    curItems = buildItems(); $('aiInfo').textContent = `${curItems.length} 場`;
    if (!curItems.length) { $('aiOut').innerHTML = '<div class="hint">範圍內沒有賽事,先到賽事頁更新。</div>'; return false; }
    return true;
  }
  $('aiRule').onclick = () => { if (!prepare()) return; setPlan(OHA.rulePlan(curItems, aiOpts())); };
  $('aiGem').onclick = async () => {
    if (!gem.key || !gem.model) { $('aiOut').innerHTML = '<div class="hint">尚未設定 Gemini。到「設定 → Gemini」貼上免費金鑰,按「載入模型清單」並儲存;或先用規則方案。</div>'; return; }
    if (!prepare()) return;
    const btn = $('aiGem'); btn.disabled = true; $('aiOut').innerHTML = `<div class="hint">Gemini 分析中${gem.search ? '(含搜尋,約 20~60 秒)' : ''}…</div>`;
    try {
      const gr = { A: 0, B: 1, C: 2 };
      const rank = curItems.slice().sort((a, b) => (gr[a.grade] - gr[b.grade]) || ((b.best ? b.best.ev : -9) - (a.best ? a.best.ev : -9)));
      const show = n => { $('aiOut').innerHTML = `<div class="hint">${n}</div>`; };
      let plan, size = gem.search ? 10 : 14, lastErr;
      for (let round = 0; round < 3 && !plan; round++) {
        const prompt = OHA.buildPrompt(rank, { budget, minOdds: cfg.minOdds, search: gem.search, SYSnames: SYSNAMES(), maxItems: size, maxCands: 3 });
        show(`Gemini 分析中(送出前 ${Math.min(size, rank.length)} 場,約 ${Math.round(prompt.length / 1000)}k 字)${gem.search ? ',含搜尋約 20~60 秒' : ''}…`);
        try { plan = await OHA.callGemini(gem.key, gem.model, prompt, gem.search, null, { onRetry: (n, c) => show(`Gemini 忙線(${c}),第 ${n} 次重試…`) }); }
        catch (e) { lastErr = e; if (e.code === 'cut' || e.code === 'timeout' || e.code === 'empty') { size = Math.max(4, Math.floor(size / 2)); continue; } throw e; }
      }
      if (!plan) throw lastErr;
      plan.src = 'ai'; setPlan(plan);
    } catch (e) { $('aiOut').innerHTML = `<div class="hint">Gemini 失敗:${esc(e.message)}。${OHA.isModelGone(e.message) ? '模型可能已不可用:到「設定 → Gemini」按「載入模型清單」重新選擇,再儲存。' : e.code === 'quota' ? '免費額度或每分鐘上限用完,等一分鐘再試。' : e.code === 'cut' || e.code === 'timeout' || e.code === 'empty' ? '已自動縮小資料量重試仍失敗,可在設定把「含搜尋」關閉再試。' : e.code === 'busy' ? 'Google 伺服器忙線,稍後再試。' : '可能是金鑰錯誤,也可先用規則方案。'}</div>`; }
    btn.disabled = false;
  };
  $('aiOut').addEventListener('click', e => {
    if (e.target.id !== 'planAdopt' || !curPlan) return;
    const p = curPlan, pid = 'P' + Date.now(), ts = Date.now(), st = planStats(p);
    const ent = (kind, id, k, stake) => { const i = itOf(id), c = candOf(id, k); return { uid: pid + id + k + kind, pid, kind, id, date: i.date, label: i.label, home: i.home, away: i.away, grade: i.grade, kick: OHT.kickMs(i.date, i.time), k, odds: c.odds, p: c.p, ev: c.ev, stake, src: p.src, ts, hit: null }; };
    p.singles.forEach(s => LOG.push(ent('單場', s.id, s.k, s.stake)));
    if (p.parlay) { p.parlay.legs.forEach(l => LOG.push(ent('串關腿', l.id, l.k, 0))); PLANS.push({ pid, src: p.src, type: p.parlay.type, stakePer: p.parlay.stakePer, legs: p.parlay.legs.map(l => ({ id: l.id, k: l.k, odds: candOf(l.id, l.k).odds, p: candOf(l.id, l.k).p, minLeg: itOf(l.id).minLeg || 1 })), ts, date: (itOf(p.parlay.legs[0].id) || {}).date, ret: null, cost: st.pr.cost }); }
    settle(); saveLog(); renderLog(); e.target.disabled = true; e.target.textContent = '已記錄';
  });
  // 結算:有比分的場次判定輸贏
  function settle() {
    if (curData && LOG.some(x => x.hit == null && !SCORES[x.id])) { if (!resIdx) resIdx = OHT.resultIndex(curData); if (OHT.autoSettle(LOG, SCORES, resIdx)) saveLog(); }
    LOG.forEach(x => { const s = SCORES[x.id]; if (s && x.hit == null) x.hit = OHA.judge(x.k, s[0], s[1]); });
    PLANS.forEach(pl => {
      if (pl.ret != null) return; if (!pl.legs.every(l => SCORES[l.id])) return;
      const r = OHP.calcSystem(pl.legs, (OHP.SYS[pl.legs.length].find(t => t[0] === pl.type) || [0, []])[1], pl.stakePer);
      pl.ret = r.combos.reduce((t, c) => t + (c.ix.every(i => OHA.judge(pl.legs[i].k, SCORES[pl.legs[i].id][0], SCORES[pl.legs[i].id][1])) ? c.odds * pl.stakePer : 0), 0);
    });
  }
  function renderLog() {
    settle(); const box = $('logBox'); if (!box) return;
    const pend = {}; LOG.filter(x => x.hit == null).forEach(x => { (pend[x.id] = pend[x.id] || { label: x.label, date: x.date, n: 0 }).n++; });
    let h = '';
    const ids = Object.keys(pend);
    if (ids.length) h += `<div class="hint" style="margin-top:0">待填比分(格式:客-主,例如 1-2)</div>` + ids.map(id => `<div class="sg"><span style="flex:1">${esc(pend[id].label)}<span class="hint" style="margin:0"> ${esc((pend[id].date || '').slice(5))}</span></span><input data-sc="${esc(id)}" placeholder="1-2" inputmode="text"><button class="btn sm alt" data-ok="${esc(id)}">結算</button></div>`).join('');
    const S = f => OHA.stats(LOG.filter(f)), A = S(() => true);
    const row = (t, s) => `<div class="pl"><span style="white-space:nowrap">${t}</span><b>${s.done ? `${s.hits}/${s.done} 中(${pct(s.hitRate)})・模型預期 ${pct(s.expHit)}・平均每注報酬 ${(s.roi * 100).toFixed(0)}%(預期 ${(s.expRoi * 100).toFixed(0)}%)` : `${s.n} 筆待結算`}</b></div>`;
    h += `<div class="plan"><h4>推薦成績(各 1 單位平注)</h4>${row('全部', A)}${row('規則方案', S(x => x.src === 'rule'))}${row('Gemini 方案', S(x => x.src === 'ai'))}${row('單場', S(x => x.kind === '單場'))}</div>`;
    const dp = PLANS.filter(p => p.ret != null), cost = dp.reduce((t, p) => t + p.cost, 0), ret = dp.reduce((t, p) => t + p.ret, 0);
    h = (afText ? `<div class="hint" style="margin-top:0">${esc(afText)}</div>` : '') + OHT.dashHtml(OHT.dash(LOG, SNAPS)) + h;
    h += `<div class="plan"><h4>系統串關實際損益</h4><div class="rs">${dp.length ? `${dp.length} 組已結算:投入 ${cost.toLocaleString()} 元,回收 ${Math.round(ret).toLocaleString()} 元,報酬 ${((ret / cost - 1) * 100).toFixed(0)}%` : '尚無已結算的串關'}</div></div>`;
    h += `<div class="hint">樣本少時(幾十筆以內)命中率與報酬的隨機波動很大,不能據此判斷 AI 有沒有用。至少累積 100 筆以上再看,並比較「實際」與「模型預期」。</div>`;
    h += `<div class="row" style="margin-top:8px"><button class="btn line sm" id="logClr">清除紀錄</button></div>`;
    box.innerHTML = h;
  }
  $('logBox').addEventListener('click', e => {
    const ok = e.target.closest('[data-ok]');
    if (ok) { const id = ok.dataset.ok, inp = $('logBox').querySelector(`[data-sc="${CSS.escape(id)}"]`), s = OHA.parseScore(inp.value); if (!s) { inp.style.borderColor = 'var(--clay)'; return; } SCORES[id] = s; settle(); saveLog(); renderLog(); }
    if (e.target.id === 'logClr' && confirm('清除所有推薦紀錄?')) { LOG = []; PLANS = []; SCORES = {}; saveLog(); renderLog(); }
  });
  function renderAIScope() {
    const ds = days(), opts = [['0', `今天 ${md(ds[0])}`], ['1', `明天 ${md(ds[1])}`], ['both', '今明兩天']];
    $('aiScope').innerHTML = opts.map(([v, t]) => `<button class="chp ${String(scope) === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('');
  }
  $('aiScope').onclick = e => { const b = e.target.closest('.chp'); if (!b) return; scope = b.dataset.v; store.set('oh_scope', scope); renderAIScope(); renderScope(); renderMine(); renderParlay(); curPlan = null; renderPlan(); };
  $('aiBudget').value = budget; $('aiBudget').onchange = e => { budget = Math.max(10, Math.floor(+e.target.value / 10) * 10 || 1000); e.target.value = budget; store.set('oh_budget', budget); };
  const gMsg = (t, bad) => { const el = $('sGMsg'); el.textContent = t; el.style.color = bad ? 'var(--clay)' : 'var(--mute)'; };
  function fillModels() {
    const L = gem.models.slice(); if (gem.model && !L.find(m => m.id === gem.model)) L.unshift({ id: gem.model, name: gem.model });
    $('sGModelSel').innerHTML = L.length ? L.map(m => `<option value="${esc(m.id)}" ${m.id === gem.model ? 'selected' : ''}>${esc(m.id)}</option>`).join('') : '<option value="">(尚未載入,請按「載入模型清單」)</option>';
  }
  const gSave = () => { gem.key = $('sGKey').value.trim(); gem.model = $('sGModelSel').value || gem.model; gem.search = $('sGSearch').checked; store.set('oh_gem', gem); };
  $('sGKey').value = gem.key; $('sGSearch').checked = gem.search; fillModels();
  $('sGModelSel').onchange = () => { gem.model = $('sGModelSel').value; store.set('oh_gem', gem); };
  $('sGList').onclick = async () => {
    const key = $('sGKey').value.trim(); if (!key) { gMsg('請先貼上金鑰', true); return; }
    gMsg('向 Google 查詢這把金鑰可用的模型…');
    try {
      const L = await OHA.listModels(key); if (!L.length) { gMsg('這把金鑰沒有可用的 Gemini 文字模型,請確認金鑰是否有效。', true); return; }
      gem.models = L; if (!L.find(m => m.id === gem.model)) gem.model = OHA.pickDefault(L); gem.key = key; store.set('oh_gem', gem); fillModels();
      gMsg(`找到 ${L.length} 個可用模型,已選用 ${gem.model}。可從清單換別的,再按「測試連線」確認。`);
    } catch (e) { gMsg('載入失敗:' + e.message, true); }
  };
  $('sGTest').onclick = async () => {
    const key = $('sGKey').value.trim(), model = $('sGModelSel').value; if (!key) { gMsg('請先貼上金鑰', true); return; } if (!model) { gMsg('請先按「載入模型清單」選一個模型', true); return; }
    gMsg('測試中…');
    try { const r = await OHA.testModel(key, model); gMsg(`連線正常:${model} 在 ${r.ms} 毫秒內回應「${r.text || '(空白)'}」。按「儲存」套用。`); }
    catch (e) { gMsg('連線失敗:' + e.message + (OHA.isModelGone(e.message) ? ' → 此模型可能已不可用,請按「載入模型清單」重新選擇。' : ''), true); }
  };
  $('sGSave').onclick = () => { gSave(); gMsg('已儲存(' + (gem.model || '尚未選模型') + ')'); };
  $('sGClear').onclick = () => { gem.key = ''; $('sGKey').value = ''; store.set('oh_gem', gem); gMsg('已清除金鑰'); };
  renderAIScope(); renderLog(); renderLab();

  // ---------- 玩運彩 ----------
  const gtOf = s => s.replace(/-/g, '');
  const rowsToMatches = rows => OHI.fromExtension(rows.map(r => ({ matchId: r[0], awayTeam: r[1], oddsAway: r[2], homeTeam: r[3], oddsHome: r[4], oddsDraw: r[5], oddsUnder: r[6], matchDate: r[7], league: r[8], oddsOver: r[9], lines: r[10] })));
  function bmPS() {
    var PWA = '__PWA__', P = '__PARSE__';
    (async function () {
      try {
        const tp = d => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }), t0 = new Date(), t1 = new Date(Date.now() + 864e5);
        if (location.hostname.indexOf('playsport.cc') < 0) { alert('請先在玩運彩網站(playsport.cc)上按這個書籤'); return; }
        const parse = new Function('return ' + P)(); let rows = [];
        for (const d of [tp(t0), tp(t1)]) {
          const g = d.replace(/-/g, ''), h = await (await fetch('/predict/scale?allianceid=4&gametime=' + g + '&sid=0', { credentials: 'omit' })).text();
          rows = rows.concat(parse(new DOMParser().parseFromString(h, 'text/html'), g));
        }
        if (!rows.length) { alert('沒有抓到足球賽事'); return; }
        const b = btoa(unescape(encodeURIComponent(JSON.stringify(rows)))).replace(/\+/g, '-').replace(/\//g, '_');
        location.href = PWA + '#oh=' + b;
      } catch (e) { alert('抓取失敗:' + (e && e.message)); }
    })();
  }
  const bmPSSrc = 'javascript:(' + bmPS.toString().replace('__PWA__', location.origin + location.pathname).replace('__PARSE__', OHI.parsePS.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')).replace(/\s*\n\s*/g, ' ') + ')()';
  $('bmPS').textContent = bmPSSrc;
  $('bmPSCopy').onclick = () => navigator.clipboard.writeText(bmPSSrc).then(() => alert('已複製'), () => alert('請長按選取文字複製'));
  let proxy = store.get('oh_proxy', 'https://aged-frost-f068.sunkinmen.workers.dev/');
  $('sProxy').value = proxy;
  async function sync(auto) {
    if (!proxy) { if (!auto) { $('impMsg').textContent = '尚未設定 Worker 網址。請用玩運彩書籤,或到設定頁填入 Worker 網址。'; } return; }
    $('impMsg').textContent = '更新中…';
    try {
      let all = [];
      for (const d of days()) {
        const r = await fetch(proxy + (proxy.includes('?') ? '&' : '?') + 'd=' + gtOf(d)); if (!r.ok) throw new Error('HTTP ' + r.status);
        all = all.concat(OHI.fromPlaysport(await r.text(), gtOf(d)));
      }
      if (!all.length) { $('impMsg').textContent = '玩運彩沒有足球賽事資料'; return; }
      addMatches(rowsToMatches(all)); store.set('oh_sync', Date.now());
    } catch (e) { $('impMsg').textContent = '自動更新失敗:' + e.message; }
  }
  $('bSync').onclick = () => sync(false);
  $('sProxySave').onclick = () => { proxy = $('sProxy').value.trim(); store.set('oh_proxy', proxy); sync(false); };

  // ---------- 補充歷史賽果 ----------
  (function () {
    const tp = today(); const y = new Date(new Date(tp + 'T00:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    $('hFrom').value = store.get('oh_hfrom', '2026-01-01'); $('hTo').value = y; $('hTo').max = y;
    let stop = false;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    $('hStop').onclick = () => { stop = true; $('hMsg').textContent += '(停止中…)'; };
    $('hGo').onclick = async () => {
      if (!curData) return; const base = (proxy || '').trim();
      if (!base) { $('hMsg').textContent = '請先在設定頁填入 Worker 網址'; return; }
      const f = $('hFrom').value, t = $('hTo').value; if (!f || !t || f > t) { $('hMsg').textContent = '日期範圍不正確'; return; }
      store.set('oh_hfrom', f);
      const list = []; for (let d = new Date(f + 'T00:00:00Z'); d <= new Date(t + 'T00:00:00Z'); d = new Date(d.getTime() + 864e5)) list.push(d.toISOString().slice(0, 10));
      if (list.length > 400) { $('hMsg').textContent = '一次最多 400 天,請縮小範圍'; return; }
      const have = OHD.haveDates(curData);
      const todo = list.filter(d => !have.has((+d.slice(0, 4) - 2000) * 10000 + +d.slice(5, 7) * 100 + +d.slice(8, 10)));
      stop = false; $('hGo').disabled = true; $('hStop').style.display = '';
      let buf = [], added = 0, done = 0, empty = 0, fail = 0;
      const flush = async () => { if (!buf.length) return; const r = await OHD.appendHistory(curData, buf); buf = []; added += r.added; useDb(r); };
      try {
        for (const d of todo) {
          if (stop) break;
          $('hMsg').textContent = `抓取中 ${done}/${todo.length}(略過已有資料 ${list.length - todo.length} 天)· 目前 ${d} · 新增 ${added} 場`;
          let ok = false;
          for (let k = 0; k < 4 && !ok && !stop; k++) {
            try {
              const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'd=' + d.replace(/-/g, ''));
              if (r.status === 429 || r.status >= 500) { $('hMsg').textContent = `被限流(HTTP ${r.status}),等待 70 秒後重試… ${d}`; await sleep(70000); continue; }
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const rows = OHI.fromPlaysport(await r.text(), d.replace(/-/g, '')).filter(x => x[11]);
              if (!rows.length) empty++; buf = buf.concat(rows); ok = true;
            } catch (e) { await sleep(3000); }
          }
          if (!ok) fail++;
          done++; if (done % 10 === 0) await flush();
          await sleep(1200);
        }
        await flush();
        $('hMsg').textContent = `${stop ? '已停止' : '完成'}:處理 ${done} 天,新增 ${added} 場${empty ? `,${empty} 天沒有已結算賽事` : ''}${fail ? `,${fail} 天失敗(再按一次會補抓)` : ''}。資料庫現有 ${curData.n.toLocaleString()} 場。`;
      } catch (e) { $('hMsg').textContent = '中斷:' + e.message; }
      $('hGo').disabled = false; $('hStop').style.display = 'none';
    };
  })();

  // ---------- 自動補資料:啟動時補抓缺少的已結算賽果(供自動結算/校準用) ----------
  async function autoFill() {
    if (afBusy || !curData) return; const base = (proxy || '').trim(); if (!base) return;
    const last = store.get('oh_autofill', 0); if (Date.now() - last < 6 * 36e5) return;
    const yd = new Date(new Date(today() + 'T00:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    const have = OHD.haveDates(curData), empty = new Set(store.get('oh_empty', []));
    const toInt = d => (+d.slice(0, 4) - 2000) * 10000 + +d.slice(5, 7) * 100 + +d.slice(8, 10);
    let mx = 0; have.forEach(v => { if (v > mx) mx = v; });
    const from = mx ? new Date(Date.UTC(2000 + Math.floor(mx / 10000), Math.floor(mx / 100) % 100 - 1, mx % 100) + 864e5).toISOString().slice(0, 10) : yd;
    const miss = d => !have.has(toInt(d)) && !empty.has(d);
    const pend = [...new Set(LOG.filter(x => x.hit == null && x.date && x.date <= yd).map(x => x.date))].filter(miss);
    const gap = []; for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= yd; d = new Date(d.getTime() + 864e5)) { const k = d.toISOString().slice(0, 10); if (miss(k) && !pend.includes(k)) gap.push(k); }
    const todo = pend.concat(gap).slice(0, 25);
    if (!todo.length) { store.set('oh_autofill', Date.now()); return; }
    afBusy = true; let buf = [], added = 0, i = 0, stopped = '';
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try {
      for (const d of todo) {
        afText = `自動補資料 ${i + 1}/${todo.length}(${d})…`; renderLog();
        const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'd=' + d.replace(/-/g, ''));
        if (r.status === 429 || r.status >= 500) { stopped = '代理被限流,稍後會再試'; break; }
        if (!r.ok) { stopped = 'HTTP ' + r.status; break; }
        const rows = OHI.fromPlaysport(await r.text(), d.replace(/-/g, '')).filter(x => x[11]);
        if (!rows.length) empty.add(d); buf = buf.concat(rows); i++;
        await sleep(1200);
      }
      if (buf.length) { const r = await OHD.appendHistory(curData, buf); added = r.added; useDb(r); }
      store.set('oh_empty', [...empty].slice(-400));
      if (!stopped) store.set('oh_autofill', Date.now());
      afText = `自動補資料:處理 ${i} 天,新增 ${added} 場已結算賽事${stopped ? '(' + stopped + ')' : ''}`;
    } catch (e) { afText = '自動補資料中斷:' + (e.message || e); }
    afBusy = false; renderLog();
  }

  // ---------- 書籤自動回傳(網址 #oh=...) ----------
  function importHash() {
    const m = location.hash.match(/^#oh=(.+)$/); if (!m) return;
    try {
      const j = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const arr = JSON.parse(j).map(r => ({ matchId: r[0], awayTeam: r[1], oddsAway: r[2], homeTeam: r[3], oddsHome: r[4], oddsDraw: r[5], oddsUnder: r[6], matchDate: r[7], league: r[8], oddsOver: r[9], lines: r[10] }));
      activeDay = 0; store.set('oh_day', 0);
      addMatches(OHI.fromExtension(arr));
    } catch (e) { $('impMsg').textContent = '自動匯入失敗:' + e.message; }
    history.replaceState(null, '', location.pathname + location.search);
  }
  window.addEventListener('hashchange', importHash);

  /* ---- 策略實驗室 / 資金管理 ---- */
  function labTag(an, b) {
    if (!LAB || !b) return '';
    const g = eliteLg(an.resolved.league) ? '頂級' : '其他', id = b.market === '勝平負' ? '異常·貝氏收縮|勝平負|' + g : b.key === 'U' ? '異常·原始|小分|' + g : null;
    const r = id && LAB.rows.find(x => x.id === id); if (!r) return '';
    return `<span class="tag plain" title="2025 起滾動回測 ${r.n} 場:命中 ${pct(r.hit)}、平均報酬 ${(r.roi * 100).toFixed(0)}%(區間 ${(r.roiLo * 100).toFixed(0)}~${(r.roiHi * 100).toFixed(0)}%)">實驗室:${r.pass ? '通過' : '未通過'}・歷史報酬 ${(r.roi * 100).toFixed(0)}%</span>`;
  }
  function labName(r) {
    const p = r.id.split('|'), g = p[p.length - 1];
    if (r.kind === 'bet') return p[0] === '對照' ? `對照:${p[1]}(${g})` : `${p[0]} ${p[1]}(${g})`;
    return `${p[1].replace('進球模型 vs ', '')}(${g})`;
  }
  function renderLab() {
    const box = $('labBox'); if (!box) return;
    if (!LAB) { box.innerHTML = '<div class="hint" style="margin-top:0">策略實驗室資料載入中…(或尚未上傳 data/lab.json)</div>'; return; }
    let h = `<div class="hint" style="margin-top:0">${esc(LAB.note)};${LAB.from} 起,更新 ${LAB.built}。判定標準:下注規則要「平均報酬為正、95% 區間下界 > 0,且經多重檢定校正 q < 0.1」;比分規則要「顯著優於進球模型」。試的規則越多越容易碰巧找到有效的,所以要校正。</div>`;
    const bets = LAB.rows.filter(r => r.kind === 'bet').sort((a, b) => b.roi - a.roi), sc = LAB.rows.filter(r => r.kind === 'score');
    h += '<div class="rs" style="margin-top:8px">下注規則(用台彩實際賠率計報酬)</div>' + bets.map(r => `<div class="pl"><span>${esc(labName(r))}<br><small class="s2">${r.n.toLocaleString()} 場・命中 ${pct(r.hit)}(市場預期 ${pct(r.exp)})</small></span><b style="color:${r.pass ? 'var(--deep)' : 'var(--clay)'}">${(r.roi * 100).toFixed(1)}%<br><small>[${(r.roiLo * 100).toFixed(0)}, ${(r.roiHi * 100).toFixed(0)}] ${r.pass ? '通過' : '未通過'}</small></b></div>`).join('');
    h += '<div class="rs" style="margin-top:8px">比分前三名(對比進球模型)</div>' + sc.map(r => `<div class="pl"><span>${esc(labName(r))}<br><small class="s2">${r.n.toLocaleString()} 場</small></span><b style="color:${r.pass ? 'var(--deep)' : 'var(--clay)'}">${pct(r.hit)} vs 模型 ${pct(r.ref)}<br><small>${r.pass ? '通過' : '未通過'}</small></b></div>`).join('');
    if (LAB.cal) h += `<div class="hint">貝氏收縮效果:「異常」場次(${LAB.cal.raw.n.toLocaleString()} 場)原始集中度平均 ${pct(LAB.cal.raw.pred)},實際只命中 ${pct(LAB.cal.raw.hit)};收縮後預測 ${pct(LAB.cal.shr.pred)},更接近實際(小樣本的「100%」會被拉回)。</div>`;
    h += '<div class="hint">賠率走勢(資金流向)規則:快照仍在累積,資料不足,暫不評估;累積幾個月後會加進這裡一起接受檢驗。正確比分沒有歷史台彩賠率,所以比分規則只比命中率,不算報酬。</div>';
    box.innerHTML = h;
  }
  function riskHtml(p, st) {
    const M = window.OHM; if (!M || !budget) return '';
    const singles = p.singles.map(s => { const c = candOf(s.id, s.k), i = itOf(s.id); return { s, c, i }; }).filter(x => x.c);
    let h = '<details class="note"><summary>ⓘ 資金管理</summary><div class="plan">';
    if (singles.length) {
      h += singles.map(x => { const f = M.kelly(x.c.p, x.c.odds, { frac: 0.25, cap: 0.05, pSd: 0.05 }), fm = M.kelly(x.c.pm, x.c.odds, { frac: 0.25, cap: 0.05 });
        return `<div class="pl"><span>${esc(x.i.label)}<br><b>${OHA.LAB[x.s.k]}</b> @${x.c.odds}</span><b>${f > 0 ? Math.round(f * budget / 10) * 10 + ' 元' : '0 元'}<br><small class="s2">${f > 0 ? '占預算 ' + (f * 100).toFixed(1) + '%' : '期望值為負,凱利不建議'}${fm <= 0 && f > 0 ? '・以市場機率算仍為負' : ''}</small></b></div>`; }).join('');
      const bets = singles.map(x => ({ p: x.c.p, odds: x.c.odds, stake: x.s.stake / budget })), betsM = singles.map(x => ({ p: x.c.pm, odds: x.c.odds, stake: x.s.stake / budget }));
      const a = M.simulate(bets, 50, 2000, 7), b = M.simulate(betsM, 50, 2000, 7);
      h += `<div class="rs" style="margin-top:6px">照這個單場配置連續投 50 次(蒙地卡羅 2000 次):<br>・用模型機率:資金中位數 ${(a.median * 100).toFixed(0)}%、最差 10% 剩 ${(a.p10 * 100).toFixed(0)}%、虧掉一半以上機率 ${(a.pHalf * 100).toFixed(0)}%<br>・用市場去水機率:資金中位數 ${(b.median * 100).toFixed(0)}%、最差 10% 剩 ${(b.p10 * 100).toFixed(0)}%、虧掉一半以上機率 ${(b.pHalf * 100).toFixed(0)}%</div>`;
    }
    if (p.parlay) {
      const L = p.parlay.legs.map(l => { const c = candOf(l.id, l.k); return c ? { odds: c.odds, p: c.p, pm: c.pm } : null; }).filter(Boolean);
      if (L.length >= 2) { const r = M.parlay(L); h += `<div class="rs" style="margin-top:6px">串關抽水疊加:${L.length} 場全中的有效抽水約 <b>${(r.margin * 100).toFixed(0)}%</b>(單場約 ${(Math.min(...L.map(l => 1 - l.pm * l.odds)) * 100).toFixed(0)}~${(Math.max(...L.map(l => 1 - l.pm * l.odds)) * 100).toFixed(0)}%);各腿抽水相乘,所以多數情況單場的期望虧損比串關小,串關靠的是波動(低機率高報酬),不是優勢。</div>`; }
    }
    return h + '</div></details>';
  }
  fetch('data/lab.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j && j.rows) { LAB = j; renderLab(); render(); } }).catch(() => { });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  render(); importHash();
  if (proxy && Date.now() - store.get('oh_sync', 0) > 10 * 60 * 1000 && !location.hash) sync(true);
})();
