// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Drop-in, ultra-robust: flexible data sniffing + strict→permissive fallback + inline debug panel.
// Uses your existing CSS classes: .year-cal, .cal-month, h4, .cal-dow, .cal-grid, .cal-day

(function () {
  'use strict';

  const QS = new URLSearchParams(location.search);
  const FORCE_DEBUG = QS.get('debug') === '1';
  const FORCE_ALL   = QS.get('all') === '1';

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const HEAT   = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('#busy .year-cal') || ensureHost();
    if (!host) return;

    const YEAR = getYear();
    buildCalendar(host, YEAR);

    // Try immediately; otherwise wait/poll for TOTALS to exist
    if (!applyHeatWithFallback(YEAR)) {
      document.addEventListener('totals-ready', () => applyHeatWithFallback(YEAR));
      let tries = 0;
      const t = setInterval(() => {
        if (applyHeatWithFallback(YEAR) || ++tries > 60) clearInterval(t); // ~30s
      }, 500);
    }
  });

  function ensureHost() {
    const card = document.querySelector('#busy .card');
    if (!card) return null;
    const div = document.createElement('div');
    div.className = 'year-cal';
    card.appendChild(div);
    return div;
  }

  function getYear() {
    const y = Number(new URLSearchParams(location.search).get('year'));
    return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : new Date().getFullYear();
  }

  function buildCalendar(host, YEAR) {
    host.innerHTML = '';
    for (let m = 0; m < 12; m++) {
      const sec = document.createElement('section');
      sec.className = 'cal-month';

      const h4 = document.createElement('h4');
      h4.textContent = `${MONTHS[m]} ${YEAR}`;
      sec.appendChild(h4);

      const dow = document.createElement('div');
      dow.className = 'cal-dow';
      ['S','M','T','W','T','F','S'].forEach(l => {
        const d = document.createElement('div');
        d.textContent = l;
        dow.appendChild(d);
      });
      sec.appendChild(dow);

      const grid = document.createElement('div');
      grid.className = 'cal-grid';

      const first = new Date(YEAR, m, 1);
      const startDow = first.getDay();
      const daysInMonth = new Date(YEAR, m + 1, 0).getDate();

      for (let i = 0; i < startDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day muted';
        grid.appendChild(blank);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const el = document.createElement('div');
        el.className = 'cal-day heat-b0';
        el.dataset.date = `${YEAR}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        el.textContent = d;

        const t = new Date();
        if (YEAR === t.getFullYear() && m === t.getMonth() && d === t.getDate()) {
          el.classList.add('today');
        }
        grid.appendChild(el);
      }

      sec.appendChild(grid);
      host.appendChild(sec);
    }

    // Add (or reuse) a compact debug panel after the calendar
    const parent = host.parentElement || document.querySelector('#busy .card') || host;
    if (!parent.querySelector('.busy-debug')) {
      const dbg = document.createElement('div');
      dbg.className = 'busy-debug';
      dbg.style.cssText = 'margin-top:8px;font:12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;color:#374151;';
      parent.appendChild(dbg);
    }
  }

  // Try strict; if nothing, auto-fallback to permissive (unless user forced strict)
  function applyHeatWithFallback(YEAR) {
    const totals = window.TOTALS;
    if (!totals || !Object.keys(totals).length) {
      showDebug({year: YEAR, note: 'TOTALS not ready or empty.', counts: {}});
      return false;
    }

    const strict = buildCounts(totals, YEAR, /*permissive=*/FORCE_ALL ? true : false);
    if (sumValues(strict) > 0 || FORCE_ALL) {
      colorize(strict);
      showDebug(summary(strict, YEAR, /*permissive=*/FORCE_ALL));
      return true;
    }

    // Strict found nothing -> fallback permissive
    const fallback = buildCounts(totals, YEAR, /*permissive=*/true);
    colorize(fallback);
    showDebug(summary(fallback, YEAR, /*permissive=*/true, 'Fallback to permissive (no national/public metadata detected).'));
    return true;
  }

  // Flexible extractor + filter -> { 'YYYY-MM-DD': count }
  function buildCounts(TOTALS, YEAR, permissive) {
    const map = Object.create(null);

    for (const [, rec] of Object.entries(TOTALS)) {
      const days = findYearDays(rec, YEAR);
      if (!days.length) continue;

      for (const day of days) {
        const dateStr = normalizeDate(day);
        if (!dateStr || !String(dateStr).startsWith(String(YEAR))) continue;
        if (!permissive && !isNational(day)) continue;

        map[dateStr] = (map[dateStr] || 0) + 1;
      }
    }
    return map;
  }

  // Heuristics to locate a YEAR's holidays array inside varied record shapes
  function findYearDays(rec, YEAR) {
    if (!rec) return [];

    // Common
    if (Array.isArray(rec.days)) return rec.days;

    // Alternative field names
    if (Array.isArray(rec.holidays)) return rec.holidays;
    if (Array.isArray(rec.list)) return rec.list;
    if (Array.isArray(rec.items)) return rec.items;
    if (Array.isArray(rec.data)) return rec.data;

    // Nested by year
    if (rec.daysByYear && Array.isArray(rec.daysByYear[YEAR])) return rec.daysByYear[YEAR];
    if (rec.byYear && Array.isArray(rec.byYear[YEAR])) return rec.byYear[YEAR];

    // Sometimes the year key is directly an array
    if (Array.isArray(rec[YEAR])) return rec[YEAR];

    // Last resort: try to flatten any arrays inside the record that look like day objects/strings for that YEAR
    const candidates = [];
    for (const v of Object.values(rec)) {
      if (Array.isArray(v)) candidates.push(...v);
    }
    // Keep only entries that can be normalized to the target YEAR
    return candidates.filter(x => {
      const ds = normalizeDate(x);
      return ds && String(ds).startsWith(String(YEAR));
    });
  }

  // Paint days based on counts
  function colorize(countsByDate) {
    const nodes = document.querySelectorAll('#busy .cal-day[data-date]');
    for (const el of nodes) {
      for (const h of HEAT) el.classList.remove(h);
      el.classList.remove('holiday');

      const date = el.dataset.date;
      const n = countsByDate[date] || 0;

      if (n > 0) el.classList.add('holiday');
      el.classList.add(countToBin(n));
      el.title = `${fmtDate(date)} — ${n} ${n === 1 ? 'country' : 'countries'} celebrate`;
    }
  }

  // ---- Helpers ----

  function normalizeDate(day) {
    if (day == null) return null;

    // If raw string/number/Date
    if (typeof day === 'string' || typeof day === 'number' || day instanceof Date) {
      const dt = new Date(day);
      if (isNaN(dt)) return null;
      return ymd(dt);
    }

    // Object: try common properties
    const raw = day.date || day.observed || day.iso || day.datetime || day.on || day.when || day.start;
    if (!raw) return null;
    const dt = new Date(raw);
    if (isNaN(dt)) return null;
    return ymd(dt);

    function ymd(dt) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  function isNational(day) {
    // Nager style
    if (day && typeof day === 'object') {
      if (day.global === true) return true;
      if (Array.isArray(day.counties) && day.counties.length > 0) return false;
    }
    // Calendarific/mixed
    const typesJoined = Array.isArray(day?.types) ? day.types.join(' ') : (day?.type || day?.holidayType || '');
    const t = String(typesJoined).toLowerCase();

    // Generic scope/level
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    if (scope.includes('national')) return true;

    if (day?.national === true) return true;
    if (t.includes('national') || t.includes('public')) return true;

    // If no metadata at all but also no counties, be conservative (strict mode will drop it)
    return false;
  }

  function countToBin(n) {
    if (n === 0) return 'heat-b0';
    if (n === 1) return 'heat-b1';
    if (n <= 4) return 'heat-b2';
    if (n <= 9) return 'heat-b3';
    if (n <= 14) return 'heat-b4';
    if (n <= 19) return 'heat-b5';
    if (n <= 29) return 'heat-b6';
    if (n <= 39) return 'heat-b7';
    if (n <= 59) return 'heat-b8';
    return 'heat-b9';
  }

  function fmtDate(yyyyMmDd) {
    const [y,m,d] = yyyyMmDd.split('-').map(Number);
    return `${MONTHS[m-1]} ${d}`;
  }

  function sumValues(obj) {
    let s = 0; for (const v of Object.values(obj)) s += v || 0; return s;
  }

  function summary(counts, YEAR, permissive, extraNote) {
    const vals = Object.entries(counts);
    vals.sort((a,b) => b[1]-a[1]);
    const nonZero = vals.filter(([,n]) => n>0);
    const max = nonZero.length ? nonZero[0][1] : 0;
    const top = nonZero.slice(0,12);

    return {
      year: YEAR,
      permissive,
      max,
      nonZeroDays: nonZero.length,
      sampleDomDate: (document.querySelector('#busy .cal-day[data-date]') || {}).dataset?.date || '(none)',
      top,
      note: extraNote
    };
  }

  function showDebug(info) {
    const dbg = document.querySelector('.busy-debug');
    if (!dbg) return;

    const shouldShow = FORCE_DEBUG || (info.nonZeroDays === 0) || info.note;
    if (!shouldShow) { dbg.innerHTML = ''; return; }

    const head = `
      <div style="padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa">
        <div style="font-weight:600;margin-bottom:6px">World Holiday Calendar — Debug</div>
        <div>Year: <b>${info.year}</b> • Mode: <b>${info.permissive ? 'Permissive' : 'Strict'}</b> • Days with ≥1 holiday: <b>${info.nonZeroDays||0}</b> • Max/day: <b>${info.max||0}</b></div>
        <div style="margin-top:4px;color:#6b7280">DOM sample day: <code>${info.sampleDomDate || ''}</code></div>
        ${info.note ? `<div style="margin-top:6px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;padding:6px;border-radius:6px">${info.note}</div>` : ''}
        ${Array.isArray(info.top) && info.top.length ? renderTop(info.top) : '<div style="margin-top:6px;">No non-zero dates to list.</div>'}
        <div style="margin-top:6px;color:#6b7280">Tip: add <code>?debug=1</code> to always show this panel, and <code>&all=1</code> to force permissive mode.</div>
      </div>
    `;
    dbg.innerHTML = head;

    function renderTop(top) {
      const rows = top.map(([d,n]) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${fmtDate(d)}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee;">${n}</td></tr>`).join('');
      return `<div style="margin-top:8px">
        <div style="font-weight:600;margin-bottom:4px">Top dates</div>
        <table style="border-collapse:collapse;width:auto;min-width:240px">${rows}</table>
      </div>`;
    }
  }
})();
