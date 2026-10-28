/* 歷史資料庫:內建預設 + 使用者更換(存在 IndexedDB) */
(function (root) {
  const BUILTIN_NAME = '足球2026_修正版.xlsx(內建)';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('oh_data', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const idbGet = k => tx('readonly', s => s.get(k)), idbSet = (k, v) => tx('readwrite', s => s.put(v, k)), idbDel = k => tx('readwrite', s => s.delete(k));

  function range(d) { let lo = 1e9, hi = 0; for (const v of d) if (v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; } const f = v => v ? `20${String(v).slice(0, 2)}-${String(v).slice(2, 4)}-${String(v).slice(4, 6)}` : '?'; return [f(lo), f(hi)]; }
  async function loadActive() {
    let u = null; try { u = await idbGet('user'); } catch (e) { }
    const data = await (await fetch('data/matches.json')).json();
    const [from, to] = range(data.d);
    const built = { data, meta: { name: BUILTIN_NAME, rows: data.n, from, to }, custom: false };
    if (u && u.data && u.data.n > 100) {
      const auto = u.meta && u.meta.name === '足球資料庫(含玩運彩補充)';      // 由 App 自動補抓累積的資料
      if (!auto || u.meta.to > to) return { data: u.data, meta: u.meta, custom: true };   // 手動匯入的永遠優先;自動補抓的只在比內建新時才用
      try { await idbDel('user'); } catch (e) { }                                       // 內建已更新且涵蓋,捨棄舊的補抓快取
    }
    return built;
  }
  async function resetToBuiltin() { try { await idbDel('user'); } catch (e) { } }

  const WD = { '週一': 0, '週二': 1, '週三': 2, '週四': 3, '週五': 4, '週六': 5, '週日': 6, '週天': 6 };
  const nt = s => String(s == null ? '' : s).replace(/[\s 　]+/g, ' ').trim();
  function dateInt(v) {   // -> yymmdd 或 0
    if (v == null || v === '') return 0;
    if (typeof v === 'number') {
      if (v >= 19000101 && v <= 29991231) return v - 20000000;       // 20250131
      if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return (d.getUTCFullYear() - 2000) * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
      return 0;
    }
    if (v instanceof Date) return (v.getFullYear() - 2000) * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
    const m = String(v).match(/(\d{4})[-\/.]?(\d{1,2})[-\/.]?(\d{1,2})/); return m ? (+m[1] - 2000) * 10000 + (+m[2]) * 100 + (+m[3]) : 0;
  }
  function minutesOf(v) {
    if (typeof v === 'number' && v >= 0 && v < 1) return Math.round(v * 1440);
    const m = String(v == null ? '' : v).match(/(AM|PM|上午|下午)?\s*(\d{1,2}):(\d{2})/i); if (!m) return -1;
    let h = +m[2]; const ap = (m[1] || '').toUpperCase();
    if (ap === 'PM' || ap === '下午') h = h % 12 + 12; else if (ap === 'AM' || ap === '上午') h = h % 12;
    return h * 60 + +m[3];
  }
  function pack(aoa, name) {
    const head = aoa[0].map(nt); const ix = n => head.indexOf(n);
    const C = { l: ix('聯賽'), s: ix('比數'), a: ix('客隊'), h: ix('主隊'), oa: ix('客賠率'), od: ix('和賠率'), oh: ix('主賠率'), ou: ix('小分賠率'), t: ix('時間'), w: ix('星期'), d: ix('日期'), src: ix('日期時間來源') };
    if (C.h < 0 || C.a < 0 || C.oh < 0 || C.s < 0) throw new Error('找不到欄位:需要 聯賽/比數/客隊/主隊/客賠率/和賠率/主賠率/小分賠率/時間/星期/日期');
    const teams = new Map(), lgs = new Map();
    const id = (m, k) => { let v = m.get(k); if (v === undefined) { v = m.size; m.set(k, v); } return v; };
    const o = { l: [], a: [], h: [], ga: [], gh: [], oa: [], od: [], oh: [], ou: [], d: [], w: [], t: [] };
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i]; if (!r) continue;
      const sc = String(r[C.s] == null ? '' : r[C.s]).match(/\d+/g); if (!sc || sc.length !== 2) continue;
      const oa = +r[C.oa], od = +r[C.od], oh = +r[C.oh]; if (!(oa > 1 && od > 1 && oh > 1)) continue;
      const ou = C.ou >= 0 ? +r[C.ou] : 0;
      const d = dateInt(r[C.d]); const mi = C.t >= 0 ? minutesOf(r[C.t]) : -1;
      const est = C.src >= 0 && String(r[C.src] || '').includes('順序推算');
      const ok = mi >= 0 && d > 0 && !est;
      o.l.push(id(lgs, nt(r[C.l]))); o.a.push(id(teams, nt(r[C.a]))); o.h.push(id(teams, nt(r[C.h])));
      o.ga.push(+sc[0]); o.gh.push(+sc[1]); o.oa.push(Math.round(oa * 100)); o.od.push(Math.round(od * 100)); o.oh.push(Math.round(oh * 100));
      o.ou.push(ou > 1 ? Math.round(ou * 100) : 0); o.d.push(d);
      let w = C.w >= 0 && WD[nt(r[C.w])] != null ? WD[nt(r[C.w])] : 7; o.w.push(ok ? w : 7); o.t.push(ok ? Math.floor(mi / 5) : -1);
    }
    return { teams: [...teams.keys()], leagues: [...lgs.keys()], ...o, n: o.h.length };
  }
  function loadScript(src) { return new Promise((res, rej) => { if (root.XLSX) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('無法載入解析套件')); document.head.appendChild(s); }); }
  async function importFile(file) {
    let data;
    if (/\.json$/i.test(file.name)) data = JSON.parse(await file.text());
    else {
      await loadScript('lib/xlsx.mini.min.js');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const nm = wb.SheetNames.includes('2025') ? '2025' : wb.SheetNames.find(n => !/說明|對照/.test(n)) || wb.SheetNames[0];
      data = pack(XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: null }), file.name);
    }
    if (!data || !(data.n > 100) || !data.teams) throw new Error('資料列數太少或格式不符(至少需要 100 場)');
    const [from, to] = range(data.d);
    const meta = { name: file.name, rows: data.n, from, to, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    await idbSet('user', { data, meta });
    return { data, meta, custom: true };
  }
  /* 匯出目前資料庫為 xlsx(欄位與原檔相同的前 11 欄) */
  function toAoa(data) {
    const WD = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'], out = [['聯賽', '比數', '客隊', '主隊', '客賠率', '和賠率', '主賠率', '小分賠率', '時間', '星期', '日期']];
    const o = v => v > 0 ? v / 100 : null;
    for (let i = 0; i < data.n; i++) {
      const t = data.t[i], mins = t >= 0 ? t * 5 : -1, hh = Math.floor(mins / 60);
      out.push([data.leagues[data.l[i]], `${data.ga[i]} V.S. ${data.gh[i]}`, data.teams[data.a[i]], data.teams[data.h[i]], o(data.oa[i]), o(data.od[i]), o(data.oh[i]), o(data.ou[i]),
        mins >= 0 ? `${hh >= 12 ? 'PM' : 'AM'} ${String(hh % 12 || 12).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` : null, data.w[i] < 7 ? WD[data.w[i]] : null, data.d[i] > 0 ? 20000000 + data.d[i] : null]);
    }
    return out;
  }
  async function exportXlsx(data) {
    await loadScript('lib/xlsx.mini.min.js');
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(toAoa(data)), '2025');
    const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '');
    XLSX.writeFile(wb, `足球資料庫_${d}.xlsx`);
  }
  /* 把玩運彩已結算賽事(OHI.parsePS 回傳列,第 12 欄為比分)併入資料庫並存到 IndexedDB;以 日期+主隊+客隊 去重 */
  async function appendHistory(data, rows) {
    const tm = new Map(data.teams.map((v, i) => [v, i])), lm = new Map(data.leagues.map((v, i) => [v, i]));
    const id = (m, arr, k) => { let v = m.get(k); if (v === undefined) { v = arr.length; arr.push(k); m.set(k, v); } return v; };
    const seen = new Set(); for (let i = 0; i < data.n; i++) seen.add(data.d[i] + '|' + data.h[i] + '|' + data.a[i]);
    let added = 0;
    rows.forEach(r => {
      const sc = r[11]; if (!sc) return;
      const m = String(r[7]).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/); if (!m) return;
      const d = (+m[1] - 2000) * 10000 + +m[2] * 100 + +m[3];
      const h = id(tm, data.teams, nt(r[3])), a = id(tm, data.teams, nt(r[1]));
      const key = d + '|' + h + '|' + a; if (seen.has(key)) return; seen.add(key);
      const mins = +m[4] * 60 + +m[5], wd = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
      data.l.push(id(lm, data.leagues, nt(r[8]))); data.a.push(a); data.h.push(h); data.ga.push(sc[0]); data.gh.push(sc[1]);
      data.oa.push(Math.round(r[2] * 100)); data.od.push(Math.round(r[5] * 100)); data.oh.push(Math.round(r[4] * 100));
      data.ou.push(r[6] > 1 ? Math.round(r[6] * 100) : 0); data.d.push(d); data.w.push(wd); data.t.push(Math.floor(mins / 5)); added++;
    });
    data.n = data.h.length;
    const [from, to] = range(data.d);
    const meta = { name: '足球資料庫(含玩運彩補充)', rows: data.n, from, to, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    await idbSet('user', { data, meta });
    return { data, meta, custom: true, added };
  }
  const haveDates = data => { const s = new Set(); for (let i = 0; i < data.n; i++) s.add(data.d[i]); return s; };
  root.OHD = { appendHistory, haveDates, loadActive, importFile, resetToBuiltin, pack, exportXlsx, toAoa };
  if (typeof module !== 'undefined') module.exports = { pack };
})(typeof self !== 'undefined' ? self : this);
