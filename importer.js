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
        oh: +x.oddsHome, od: +x.oddsDraw, oa: +x.oddsAway, ou: x.oddsUnder ? +x.oddsUnder : 0,
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
  function parse(text) {
    text = String(text || '').trim();
    if (!text) return [];
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.matches || j.data || j.result || []);
      if (arr.length && arr[0].homeTeam) return fromExtension(arr);
      if (arr.length && (arr[0].htn || arr[0].ms)) return fromBlob(arr);
      if (arr.length && arr[0].home) return arr;
      return [];
    } catch (e) { return fromText(text); }
  }
  const api = { parse, fromExtension, fromBlob, fromText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OHI = api;
})(typeof self !== 'undefined' ? self : this);
