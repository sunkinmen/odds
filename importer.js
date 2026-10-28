/* 匯入解析: 支援 (1) 賠率獵人擴充功能 matches[] JSON (2) 運彩 blob JSON(盡力解析) (3) 純文字「主 客 主賠 和賠 客賠 [小分]」 */
(function (root) {
  const WD_FIX = d => (d.getDay() + 6) % 7;   // 週一=0
  function parseDT(s) {
    const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return {};
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return { date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, time: `${m[4].padStart(2, '0')}:${m[5]}`, weekday: WD_FIX(d), minutes: +m[4] * 60 + +m[5] };
  }
  function fromExtension(a) {
    return a.map((x, i) => {
      const t = parseDT(x.matchDate);
      return {
        id: x.matchId || ('M' + i), league: x.league || '', home: x.homeTeam, away: x.awayTeam,
        oh: +x.oddsHome, od: +x.oddsDraw, oa: +x.oddsAway, ou: x.oddsUnder ? +x.oddsUnder : 0, ov: x.oddsOver ? +x.oddsOver : 0, lines: x.lines || null,
        minLeg: x.minLeg ? +x.minLeg : 0, ...t, display: x.matchDateDisplay || ''
      };
    }).filter(m => m.home && m.away && m.oh > 1 && m.od > 1 && m.oa > 1);
  }
  const first = v => Array.isArray(v) ? v[0] : v;
  function fromBlob(a) {   // 依社群文件的欄位(htn/atn/ln/ms/cs/o)盡力解析; 欄位與實際不符時會回傳空陣列
    const out = [];
    a.forEach((x, i) => {
      const home = first(x.htn), away = first(x.atn); if (!home || !away) return;
      let oh = 0, od = 0, oa = 0, ou = 0;
      (x.ms || []).forEach(mk => {
        (mk.cs || []).forEach(cs => { void cs; });
        const sel = (mk.cs || []);
        if (sel.length === 3 && !oh) { oh = +sel[0].o; od = +sel[1].o; oa = +sel[2].o; }
      });
      if (!(oh > 1 && od > 1 && oa > 1)) return;
      const t = parseDT(x.kdt || x.ed || '');
      out.push({ id: String(x.no || x.id || 'B' + i), league: first(x.ln) || '', home, away, oh, od, oa, ou, minLeg: 0, ...t });
    });
    return out;
  }
  function fromText(s) {
    const out = [];
    s.split(/\n+/).forEach((ln, i) => {
      let p = ln.trim().split(/[\s,，、\t]+/).filter(Boolean); if (p.length < 5) return;
      let date = '', time = '';
      p = p.filter(x => { if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(x)) { date = x; return false; } if (/^\d{1,2}:\d{2}$/.test(x)) { time = x; return false; } return true; });
      const nums = p.slice(2).map(Number); if (p.length < 5 || nums.slice(0, 3).some(n => !(n > 1))) return;
      const m = { id: 'T' + i, league: '', home: p[0], away: p[1], oh: nums[0], od: nums[1], oa: nums[2], ou: nums[3] > 1 ? nums[3] : 0, minLeg: 0 };
      if (date) Object.assign(m, parseDT(date + ' ' + (time || '00:00')), time ? {} : { time: '', minutes: null });
      else if (time) { m.time = time.padStart(5, '0'); m.minutes = +time.split(':')[0] * 60 + +time.split(':')[1]; }
      out.push(m);
    });
    return out;
  }
  /* 運彩「每日賽事」頁面文字解析:不依賴 DOM 結構,只看畫面上複製出來的文字。
   * 版面(依使用者截圖):賽事編號(4位數) / 序號 / 「28 10月 18:00」 / 客隊 / 主隊 / 客賠 和賠 主賠 / 「+27」
   * 欄位順序為 客場、和局、主場。 */
  const NOISE = new Set(['客場', '和局', '主場', '全部', '電視', '直播串流', '足球', '體育', '今天', '明天', '更多', '客', '和', '主', '直播', '入金']);
  function inferDate(mon, day, today) {
    const t = today || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
    let y = +t.slice(0, 4);
    const mk = yy => `${yy}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let d = mk(y); const diff = (new Date(d) - new Date(t)) / 864e5;
    if (diff < -200) d = mk(y + 1); else if (diff > 200) d = mk(y - 1);
    return d;
  }
  function fromPageText(text, today) {
    let lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // 日期被拆成多個節點時(「28」「10月」「18:00」)先合併
    const mg = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{1,2}$/.test(lines[i]) && /^\d{1,2}\s*月$/.test(lines[i + 1] || '')) { let s = lines[i] + ' ' + lines[i + 1]; i++; if (/^\d{1,2}:\d{2}$/.test(lines[i + 1] || '')) { s += ' ' + lines[i + 1]; i++; } mg.push(s); } else mg.push(lines[i]);
    }
    lines = mg;
    const dateRe = /(\d{1,2})\s*(\d{1,2})\s*月/, timeRe = /(\d{1,2}):(\d{2})/;
    const isNo = s => /^\d{4}$/.test(s) && +s >= 1000;
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isNo(lines[i])) continue;
      for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) if (dateRe.test(lines[j])) { starts.push(i); break; }
    }
    const out = [], seen = new Set();
    let league = '';
    if (starts.length) { const pre = lines.slice(0, starts[0]).filter(x => !/^\d+$/.test(x) && !NOISE.has(x) && x.length >= 2 && !dateRe.test(x) && !/^星期/.test(x) && !/[:：]/.test(x)); league = pre.length ? pre[pre.length - 1] : ''; }
    starts.forEach((st, k) => {
      let en = k + 1 < starts.length ? starts[k + 1] : lines.length;
      const blk = lines.slice(st + 1, en);
      // 區塊在「+27」(更多盤口)處結束;其後到下一場之前的文字當作下一場的聯賽標題
      const cut = blk.findIndex(s => /^\+\d+$/.test(s));
      const body = cut >= 0 ? blk.slice(0, cut) : blk;
      const tail = cut >= 0 ? blk.slice(cut + 1) : [];
      let dm = null, tm = null; const texts = [], decs = [];
      body.forEach(s => {
        const a = s.match(dateRe); if (a && !dm) { dm = a; const b = s.match(timeRe); if (b) tm = b; return; }
        const b = s.match(timeRe); if (b && !tm && /^\d{1,2}:\d{2}$/.test(s)) { tm = b; return; }
        if (/^\d{1,3}\.\d{2}$/.test(s)) { decs.push(+s); return; }
        if (/^\d+$/.test(s) || NOISE.has(s) || s.length < 2) return;
        texts.push(s);
      });
      if (dm && decs.length >= 3 && texts.length >= 2) {
        const date = inferDate(+dm[2], +dm[1], today);
        const m = { id: lines[st] + '-' + date.slice(5), league, away: texts[0], home: texts[1], oa: decs[0], od: decs[1], oh: decs[2], ou: 0, minLeg: 0, date };
        if (tm) { m.time = tm[1].padStart(2, '0') + ':' + tm[2]; m.minutes = +tm[1] * 60 + +tm[2]; }
        m.weekday = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
        if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
      }
      const cand = tail.filter(s => !/^\d+$/.test(s) && !NOISE.has(s) && s.length >= 2 && !dateRe.test(s));
      league = cand.length ? cand[cand.length - 1] : (cut >= 0 ? '' : league);
    });
    return out;
  }
  function parse(text, ctx) {
    text = String(text || '').trim();
    if (!text) return [];
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.matches || j.data || j.result || []);
      if (arr.length && arr[0].homeTeam) return fromExtension(arr);
      if (arr.length && (arr[0].htn || arr[0].ms)) return fromBlob(arr);
      if (arr.length && arr[0].home) return arr;
      return [];
    } catch (e) {
      const pg = fromPageText(text, ctx && ctx.today);
      return pg.length ? pg : fromText(text);
    }
  }
  /* 玩運彩「預測比例」頁(足球 運彩盤)解析。自成一體,可直接 toString 放進書籤。
   * doc: 頁面 DOM;gt: 'YYYYMMDD'。回傳 [賽事編號, 客隊, 客賠, 主隊, 主賠, 和賠, 小分(2.5)賠, 'YYYY-MM-DD HH:MM', 聯賽, 大分(2.5)賠, {'3.5':[大,小],'4.5':[大,小]}, [客分,主分]|null(已結算頁才有)] */
  function parsePS(doc, gt) {
    const g = {}, order = [], tx = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    doc.querySelectorAll('tr[gameid]').forEach(function (tr) {
      const id = tr.getAttribute('gameid'); let o = g[id];
      if (!o) { o = g[id] = { teams: [], od: {}, ou: 0, ov: 0, ln: {} }; order.push(id); }
      const gi = tr.querySelector('.td-gameinfo');
      if (gi) { o.league = tx(gi.querySelector('p')); o.no = tx(gi.querySelector('h3')); o.tm = tx(gi.querySelector('h4')); }
      const t = tr.querySelector('.td-teaminfo');
      if (t) {
        const sc = t.querySelectorAll('.scores li');
        if (sc.length >= 3) {   // 已結算頁:巢狀表格,第一列客隊、最後一列主隊,比分在 .scores
          const a = parseInt(sc[0].textContent), b = parseInt(sc[2].textContent); if (a >= 0 && b >= 0) o.sc = [a, b];
          const nm = []; t.querySelectorAll('td').forEach(function (td) { if (!td.classList.contains('scores') && !td.classList.contains('teamgap') && !td.children.length && tx(td)) nm.push(tx(td)); });
          if (nm.length >= 2 && !o.teams.length) { o.teams.push(nm[0]); o.teams.push(nm[nm.length - 1]); }
        } else if (tx(t)) o.teams.push(tx(t));
      }
      tr.querySelectorAll('.td-bank-bet01,.td-bank-bet03').forEach(function (td) { const v = parseFloat(tx(td.querySelector('.data-wrap span'))); if (v > 1) o.od[tx(td.querySelector('.team-side'))] = v; });
      tr.querySelectorAll('.td-bank-bet02').forEach(function (td) {
        const side = tx(td.querySelector('.team-side')), line = tx(td.querySelector('.data-wrap strong')), v = parseFloat(tx(td.querySelector('.data-wrap span')).replace(/[^\d.]/g, ''));
        if (side === '小' && line === '2.5' && v > 1) o.ou = v;
        if (side === '大' && line === '2.5' && v > 1) o.ov = v;
        if ((line === '3.5' || line === '4.5') && v > 1 && (side === '大' || side === '小')) (o.ln[line] = o.ln[line] || [0, 0])[side === '大' ? 0 : 1] = v;
      });
    });
    const out = [], d = gt.slice(0, 4) + '-' + gt.slice(4, 6) + '-' + gt.slice(6, 8);
    order.forEach(function (id) {
      const o = g[id], m = (o.tm || '').match(/([AP])M\s*(\d+):(\d+)/);
      if (o.teams.length < 2 || !(o.od['客'] > 1 && o.od['主'] > 1 && o.od['和'] > 1)) return;
      const hh = m ? (+m[2] === 12 ? 0 : +m[2]) + (m[1] === 'P' ? 12 : 0) : 0;
      out.push([id, o.teams[0], o.od['客'], o.teams[1], o.od['主'], o.od['和'], o.ou, d + ' ' + String(hh).padStart(2, '0') + ':' + (m ? m[3] : '00'), o.league || '', o.ov, o.ln, o.sc || null]);
    });
    return out;
  }
  function fromPlaysport(html, gt) { return parsePS(new DOMParser().parseFromString(html, 'text/html'), gt); }
  const api = { parse, fromExtension, fromBlob, fromText, fromPageText, parsePS, fromPlaysport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHI = api;
})(typeof self !== 'undefined' ? self : this);
