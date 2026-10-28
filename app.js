(function () {
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const DEF = { minOdds: 1.3, minProb: 0.5, kMin: 2, kMax: 4, minJoint: 0.12, rules: '', proxy: '', src: '' };
  let cfg = Object.assign({}, DEF, store.get('oh_cfg', {}));
  let matches = store.get('oh_matches', []);
  let db = null, sortBy = 'ev', analyses = new Map();
  let activeDay = store.get('oh_day', 0);       // 0 今天 1 明天
  let scope = store.get('oh_scope', 'both');    // 0 / 1 / both
  const pct = x => (x * 100).toFixed(0) + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const WDN = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

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
  function useDb(r) {
    db = OH.load(r.data);
    $('dbstat').textContent = `${db.n.toLocaleString()} 場歷史資料 · ${r.custom ? '自訂' : '內建'}`;
    $('dbName').textContent = r.meta.name + (r.meta.at ? `(${r.meta.at} 匯入)` : '');
    $('dbRows').textContent = r.meta.rows.toLocaleString(); $('dbFrom').textContent = r.meta.from.slice(2); $('dbTo').textContent = r.meta.to.slice(2);
    render();
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
      try { const an = OH.analyze(db, m); analyses.set(m.id, { an, pb: OH.pickBest(an, m, cfg.minOdds) }); } catch (e) { console.warn(e); }
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
  function card(m) {
    const a = analyses.get(m.id); let cls = '', verdict = '', det = '';
    let hit = null;
    if (!db) verdict = '<span class="tag plain">等待資料庫…</span>';
    else if (a) {
      const { an, pb } = a, b = pb.best; hit = b;
      const unk = [an.resolved.home, an.resolved.away].some(x => x.id < 0);
      if (b) {
        cls = 'pick';
        verdict = `<span class="tag">建議 ${b.market === '小分' ? '小分' : b.side} @${b.odds}</span><span class="meter" title="機率 vs 市場"><i style="width:${b.p * 100}%"></i><b style="left:${b.pm * 100}%"></b></span><span>${pct(b.p)}</span>`;
        if (b.ev < 0) verdict += `<span class="tag plain">期望 ${(b.ev * 100).toFixed(0)}%</span>`;
        if (minLegOf(m) > 1) verdict += `<span class="tag plain">${minLegOf(m)}串起</span>`;
      } else { cls = 'skip'; verdict = '<span class="tag skip">不推薦・賠率過低或無合格選項</span>'; }
      if (an.anomaly.flag) { if (!b) cls = 'flag'; verdict += `<span class="tag flag">罕見組合 ${an.anomaly.n}場 ${pct(Math.max(...an.anomaly.c) / an.anomaly.n)}同向(${an.toHDA(an.anomaly.pick)})</span>`; }
      if (unk) verdict += '<span class="tag plain">部分隊名查無歷史</span>';
      det = `<div class="det"><div class="lg" style="margin-top:8px">強隊:${esc(an.strongName)} ・ 合併機率 勝${pct(an.p[0])} 和${pct(an.p[1])} 負${pct(an.p[2])}${an.pu ? ` ・ 小分${pct(an.pu.p)}` : ''}</div>${layerBlock(an)}
        <div class="lg2"><span><s style="background:var(--sage)"></s>強隊勝</span><span><s style="background:var(--sand)"></s>和</span><span><s style="background:var(--clay)"></s>強隊負</span></div>
        <div class="hint">罕見組合檢查:相同賠率(±3%)共 ${an.anomaly.n} 場${an.anomaly.n ? `,涉及這兩隊 ${pct(an.anomaly.teamShare)}` : ''}。回測中此訊號沒有優於選熱門。</div>
        <div class="row" style="margin:8px 0 2px"><span class="hint" style="margin:0">最低串數</span><select class="ml" style="width:auto;padding:6px 10px">${[0, 2, 3, 4, 5].map(v => `<option value="${v}" ${(m.minLeg || 0) === v ? 'selected' : ''}>${v ? v + ' 串起' : '依規則'}</option>`).join('')}</select><span class="grow"></span><button class="btn line sm del">刪除</button></div></div>`;
    }
    const pk = hit && hit.market === '勝平負' ? hit.side : null, pu = hit && hit.market === '小分';
    const ex = (a && a.an.resolved.league) || '';
    return `<article class="match ${cls}" data-id="${esc(m.id)}">
      <div class="mt"><b>${esc(m.time || '--:--')}</b><span>${esc(SHORT(m.league || ex))}</span></div>
      <div><div class="teams">${esc(m.away)}<span class="at">@</span>${esc(m.home)}</div>
        <div class="odds"><div class="o ${pk === '客' ? 'hit' : ''}"><i>客</i>${m.oa}</div><div class="o ${pk === '和' ? 'hit' : ''}"><i>和</i>${m.od}</div><div class="o ${pk === '主' ? 'hit' : ''}"><i>主</i>${m.oh}</div>${m.ou ? `<div class="o u ${pu ? 'hit' : ''}"><i>小</i>${m.ou}</div>` : '<div></div>'}</div>
        <div class="verdict">${verdict}</div></div>${det}</article>`;
  }
  const EMPTY = '<div class="empty"><svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17"/></svg><div>這天還沒有賽事</div><div class="hint">用上方「貼上匯入 / 連線抓取 / 手動新增」加入運彩賽事</div></div>';
  function render() {
    prune(); analyzeAll(); renderDays();
    const d = days()[activeDay], list = matches.filter(m => m.date === d).sort(byTime);
    $('list').innerHTML = list.length ? list.map(card).join('') : EMPTY;
    const other = matches.filter(m => !inDays(m)).length;
    $('skipMsg').textContent = other ? `另有 ${other} 場今明兩天以外的賽事已略過(後天的賽事通常還沒開賣)` : '';
    renderScope(); renderParlay();
  }
  $('list').addEventListener('click', e => {
    const c = e.target.closest('.match'); if (!c) return; const id = c.dataset.id;
    if (e.target.classList.contains('del')) { matches = matches.filter(x => x.id !== id); store.set('oh_matches', matches); render(); return; }
    if (e.target.closest('select')) return;
    c.classList.toggle('open');
  });
  $('list').addEventListener('change', e => {
    if (!e.target.classList.contains('ml')) return;
    const id = e.target.closest('.match').dataset.id, m = matches.find(x => x.id === id); m.minLeg = +e.target.value; store.set('oh_matches', matches); render();
  });

  // ---------- 串關 ----------
  function renderScope() {
    const ds = days(), opts = [['0', `今天 ${md(ds[0])}`], ['1', `明天 ${md(ds[1])}`], ['both', '今明兩天']];
    $('scope').innerHTML = opts.map(([v, t]) => `<button class="chp ${String(scope) === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('');
  }
  $('scope').onclick = e => { const b = e.target.closest('.chp'); if (!b) return; scope = b.dataset.v; store.set('oh_scope', scope); renderScope(); renderParlay(); };
  function renderParlay() {
    if (!db) return;
    const legs = [], inScope = scoped();
    inScope.forEach(m => {
      const a = analyses.get(m.id); if (!a || !a.pb.best) return; const b = a.pb.best;
      legs.push({ id: m.id, label: `${m.away} @ ${m.home}`, pick: b.market === '小分' ? '小分' : b.side, tm: `${md(m.date)} ${m.time || ''}`, odds: b.odds, p: b.p, minLeg: minLegOf(m) });
    });
    const r = OHP.recommend(legs, { ...cfg, sortBy });
    $('pInfo').textContent = `${inScope.length} 場 → 合格 ${r.pool.length} 場`;
    if (!r.picks.length) { $('parlays').innerHTML = `<div class="empty"><svg viewBox="0 0 24 24"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z"/><path d="m4 12.5 8 4.5 8-4.5"/></svg><div>目前沒有符合條件的串關</div><div class="hint">合格 ${r.pool.length} 場(賠率 ≥ ${cfg.minOdds}、機率 ≥ ${pct(cfg.minProb)})。可到設定放寬,或匯入更多賽事。</div></div>`; return; }
    $('parlays').innerHTML = r.picks.map((p, i) => `<div class="ticket"><div class="hd"><div style="display:flex;align-items:center"><span class="rank">${i + 1}</span><div><div class="k">${p.k} 串 1${p.need > 1 ? `・限${p.need}串起` : ''}</div><div class="big">${p.odds.toFixed(2)}<small>總賠率</small></div></div></div><div style="text-align:right"><div class="k">命中機率</div><div class="big">${pct(p.p)}</div></div></div><div class="perf"></div>
      <div class="legs">${p.legs.map(l => `<div class="leg"><div><div>${esc(l.label)}</div><div class="tm">${esc(l.tm)}</div></div><div class="pk">${esc(l.pick)} <span style="font-weight:500;color:var(--mute)">@${l.odds}</span></div></div>`).join('')}</div>
      <div class="ft"><span class="tag ${p.ev < 0 ? 'skip' : ''}">期望 ${(p.ev * 100).toFixed(0)}%</span><span class="tag plain">每 100 元約回 ${(100 * p.p * p.odds).toFixed(0)} 元</span></div></div>`).join('') +
      `<div class="hint" style="text-align:center;margin:12px 6px">期望值 = 命中機率 × 總賠率 − 1,幾乎都是負值,只用來比較組合之間的相對好壞。</div>`;
  }
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
      const i = matches.findIndex(x => x.id === m.id && x.home === m.home && x.date === m.date);
      if (i >= 0) { m.minLeg = m.minLeg || matches[i].minLeg; matches[i] = m; } else { matches.push(m); added++; }
    });
    store.set('oh_matches', matches); render();
    $('impMsg').textContent = `匯入 ${arr.length - drop} 場(新增 ${added})${drop ? `,略過已過期 ${drop} 場` : ''}`;
  }
  const show = id => ['importBox', 'addBox'].forEach(x => { const el = $(x); el.style.display = x === id && el.style.display === 'none' ? 'block' : 'none'; });
  $('bPaste').onclick = () => show('importBox'); $('bAdd').onclick = () => show('addBox');
  $('bDo').onclick = () => { const a = OHI.parse($('txt').value); if (a.length) { addMatches(a); $('txt').value = ''; } else $('impMsg').textContent = '解析不到任何賽事,請確認格式'; };
  $('bClip').onclick = async () => { try { $('txt').value = await navigator.clipboard.readText(); $('bDo').click(); } catch (e) { $('impMsg').textContent = '無法讀取剪貼簿,請長按貼上'; } };
  $('bClear').onclick = () => { if (confirm('清空所有賽事?')) { matches = []; store.set('oh_matches', matches); render(); } };
  $('aSave').onclick = () => {
    const m = { id: 'M' + Date.now(), league: $('aLeague').value.trim(), home: $('aHome').value.trim(), away: $('aAway').value.trim(), oh: +$('aH').value, od: +$('aD').value, oa: +$('aA').value, ou: +$('aU').value || 0, minLeg: 0 };
    if (!m.home || !m.away || !(m.oh > 1 && m.od > 1 && m.oa > 1)) { $('impMsg').textContent = '請填主客隊與三項賠率(>1)'; return; }
    const t = $('aT').value; if (t) { m.time = t; m.minutes = +t.slice(0, 2) * 60 + +t.slice(3, 5); }
    addMatches([m]); ['aHome', 'aAway', 'aH', 'aD', 'aA', 'aU'].forEach(k => $(k).value = '');
  };
  $('bFetch').onclick = async () => {
    if (!cfg.proxy || !cfg.src) { $('impMsg').textContent = '請先到「設定」填入資料代理與來源網址'; return; }
    $('impMsg').textContent = '抓取中…';
    try {
      const r = await fetch(cfg.proxy.replace(/\/$/, '') + '/?url=' + encodeURIComponent(cfg.src));
      const a = OHI.parse(await r.text());
      a.length ? addMatches(a) : $('impMsg').textContent = '抓到資料但解析不出賽事(格式與預期不同),請改用貼上匯入';
    } catch (e) { $('impMsg').textContent = '抓取失敗:' + e.message; }
  };

  // ---------- 設定 ----------
  function fillCfg() { $('sMinOdds').value = cfg.minOdds; $('sMinProb').value = cfg.minProb; $('sKMin').value = cfg.kMin; $('sKMax').value = cfg.kMax; $('sMinJoint').value = cfg.minJoint; $('sRules').value = cfg.rules; $('sProxy').value = cfg.proxy; $('sSrc').value = cfg.src; }
  $('sSave').onclick = () => {
    cfg = { minOdds: +$('sMinOdds').value || 1.3, minProb: +$('sMinProb').value || 0.5, kMin: Math.max(2, +$('sKMin').value || 2), kMax: Math.min(8, +$('sKMax').value || 4), minJoint: +$('sMinJoint').value || 0.12, rules: $('sRules').value, proxy: $('sProxy').value.trim(), src: $('sSrc').value.trim() };
    store.set('oh_cfg', cfg); render(); alert('已儲存');
  };
  fillCfg();
  const bmSrc = "(()=>{const o=[...document.querySelectorAll('[aria-label*=\"odds\"]')].map(e=>{const m=(e.getAttribute('aria-label')||'').match(/^([\\s\\S]+?)\\s*-\\s*([\\s\\S]+?)\\s*-\\s*odds\\s*([\\d.]+)\\s*$/i);return m&&{e,mk:m[1].trim(),s:m[2].trim(),o:+m[3]}}).filter(Boolean);const R=new Map();o.forEach(x=>{let c=x.e,r=null;for(let i=0;i<20&&c;i++){if(c.querySelector&&c.querySelector('[data-test-id=\"chip-event-header\"]')){r=c;break}c=c.parentElement}if(!r)return;if(!R.has(r)){const l=r.querySelector('[data-test-id=\"chip-event-header\"] label');const t=(r.textContent||'').replace(/\\s+/g,' ');const dm=t.match(/(\\d{1,2})\\s*(\\d{1,2})月/),tm=t.match(/(\\d{1,2}):(\\d{2})/);R.set(r,{id:l?l.textContent.trim():'',dt:dm&&tm?new Date().getFullYear()+'-'+dm[2]+'-'+dm[1]+' '+tm[1]+':'+tm[2]:'',mk:[]})}R.get(r).mk.push(x)});const out=[];R.forEach(d=>{let ml=null,u=0;const g={};d.mk.forEach(x=>(g[x.mk]=g[x.mk]||[]).push(x));Object.values(g).forEach(s=>{if(s.some(x=>x.s==='和局'))ml=s;const us=s.find(x=>x.s.includes('小'));if(us)u=us.o});if(!ml)return;const dr=ml.find(x=>x.s==='和局'),t=ml.filter(x=>x.s!=='和局');if(t.length<2||!d.id)return;out.push({matchId:d.id,awayTeam:t[0].s,oddsAway:t[0].o,homeTeam:t[1].s,oddsHome:t[1].o,oddsDraw:dr.o,oddsUnder:u||null,matchDate:d.dt})});const j=JSON.stringify(out);(navigator.clipboard?navigator.clipboard.writeText(j):Promise.reject()).then(()=>alert('已複製 '+out.length+' 場'),()=>prompt('複製這段:',j))})()";
  $('bm').textContent = 'javascript:' + bmSrc;
  $('bmCopy').onclick = () => navigator.clipboard.writeText('javascript:' + bmSrc).then(() => alert('已複製'), () => alert('請長按選取文字複製'));

  // ---------- Tab ----------
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    ['matches', 'parlay', 'set'].forEach(t => $('tab-' + t).style.display = t === b.dataset.t ? 'block' : 'none');
    $('days').style.display = b.dataset.t === 'matches' ? 'grid' : 'none';
    window.scrollTo(0, 0);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  render();
})();
