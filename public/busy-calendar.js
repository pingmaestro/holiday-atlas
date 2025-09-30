// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Builds a full-year grid and heat-shades each date by # of countries with a NATIONAL/PUBLIC holiday.
// Uses your existing CSS classes: .year-cal, .cal-month, h4, .cal-dow, .cal-grid, .cal-day

(function () {
  'use strict';

  // Turn on for console diagnostics:
  const DEBUG = true;

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const HEAT   = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  // ---- Boot ----
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('#busy .year-cal') || ensureHost();
    if (!host) return;

    const YEAR = getYear();
    buildCalendar(host, YEAR); // render grid immediately

    // Try to color now; otherwise wait for TOTALS and poll briefly
    if (!applyHeatIfAvailable(YEAR)) {
      document.addEventListener('totals-ready', () => applyHeatIfAvailable(YEAR));
      let tries = 0;
      const timer = setInterval(() => {
        if (applyHeatIfAvailable(YEAR) || ++tries > 60) clearInterval(timer); // ~30s
      }, 500);
    }
  });

  // ---- DOM helpers ----
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

      // Weekday header
      const dow = document.createElement('div');
      dow.className = 'cal-dow';
      ['S','M','T','W','T','F','S'].forEach(l => {
        const d = document.createElement('div');
        d.textContent = l;
        dow.appendChild(d);
      });
      sec.appendChild(dow);

      // Days grid
      const grid = document.createElement('div');
      grid.className = 'cal-grid';

      const first = new Date(YEAR, m, 1);
      const startDow = first.getDay(); // 0..6 (Sun..Sat)
      const daysInMonth = new Date(YEAR, m + 1, 0).getDate();

      // leading blanks
      for (let i = 0; i < startDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day muted';
        grid.appendChild(blank);
      }

      // day cells
      for (let d = 1; d <= daysInMonth; d++) {
        const el = document.createElement('div');
        el.className = 'cal-day heat-b0'; // neutral by default
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
  }

  // ---- Heat application ----
  function applyHeatIfAvailable(YEAR) {
    const totals = window.TOTALS;
    if (!totals || !Object.keys(totals).length) {
      DEBUG && console.debug('[busy-calendar] TOTALS not ready or empty.');
      return false;
    }
    const counts = tallyCounts(totals, YEAR);
    colorize(counts);

    if (DEBUG) {
      const sum = Object.values(counts).reduce((a,b)=>a+b,0);
      const max = Math.max(0, ...Object.values(counts));
      const nonZero = Object.keys(counts).filter(k => counts[k] > 0).length;
      console.debug(`[busy-calendar] YEAR=${YEAR} dates with ≥1 holiday: ${nonZero}, total increments: ${sum}, max/day: ${max}`);
      if (nonZero === 0) {
        console.debug('[busy-calendar] No qualifying days — likely the filter is too strict for your data; see isNational().');
      }
      // Check that date attributes match DOM
      const sample = document.querySelector('#busy .cal-day[data-date]');
      if (sample) console.debug('[busy-calendar] sample DOM date attr:', sample.dataset.date);
    }
    return true;
  }

  // Reduce TOTALS -> { 'YYYY-MM-DD': count } for NATIONAL/PUBLIC days only
  function tallyCounts(TOTALS, YEAR) {
    const map = Object.create(null);

    for (const [, rec] of Object.entries(TOTALS)) {
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const day of days) {
        const dateStr = normalizeDate(day);
        if (!dateStr || !String(dateStr).startsWith(String(YEAR))) continue;
        if (!isNational(day)) continue;
        map[dateStr] = (map[dateStr] || 0) + 1;
      }
    }
    return map;
  }

  // Paint days based on counts
  function colorize(countsByDate) {
    const nodes = document.querySelectorAll('#busy .cal-day[data-date]');
    for (const el of nodes) {
      // clear old state
      for (const h of HEAT) el.classList.remove(h);
      el.classList.remove('holiday');

      const date = el.dataset.date;
      const n = countsByDate[date] || 0;

      if (n > 0) el.classList.add('holiday'); // reuses your badge style
      el.classList.add(countToBin(n));
      el.title = `${fmtDate(date)} — ${n} ${n === 1 ? 'country' : 'countries'} celebrate`;
    }
  }

  // ---- Helpers (robust across sources/pipelines) ----

  // Normalize to 'YYYY-MM-DD'
  // Supports:
  //  - string: '2025-1-1' or '2025-01-01' or ISO datetime
  //  - object: {date}, {observed}, {iso}, {datetime}
  function normalizeDate(day) {
    if (day == null) return null;

    // If the entry is already a date-like string
    if (typeof day === 'string' || typeof day === 'number') {
      const dt = new Date(day);
      if (isNaN(dt)) return null;
      return ymd(dt);
    }

    // Object with common fields
    const raw = day.date || day.observed || day.iso || day.datetime;
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

  // Nationwide/public filter (covers Nager, Calendarific, and generic pipeline fields)
  function isNational(day) {
    // Nager: global === true means nationwide; counties listed => regional only
    if (day && typeof day === 'object') {
      if (day.global === true) return true;
      if (Array.isArray(day.counties) && day.counties.length > 0) return false;
    }

    // Calendarific / mixed: type(s) may include 'National holiday' or 'Public'
    const typesJoined = Array.isArray(day?.types) ? day.types.join(' ') : (day?.type || day?.holidayType || '');
    const t = String(typesJoined).toLowerCase();

    // Generic fields your pipeline might set
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    if (scope.includes('national')) return true;

    // Some sources store a boolean
    if (day?.national === true) return true;

    // Fallback text match
    if (t.includes('national') || t.includes('public')) return true;

    // If we have NO type/scope info at all and no sub-regions, assume national (permissive).
    if (day && typeof day === 'object') {
      const noTypeInfo = !day.type && !day.types && !day.holidayType && !day.scope && !day.level;
      const noCounties = !Array.isArray(day.counties) || day.counties.length === 0;
      if (noTypeInfo && noCounties && day.global !== false) return true;
    }

    // If day is a raw string (no metadata), be permissive so you see heat
    if (typeof day === 'string' || typeof day === 'number') return true;

    return false;
  }

  // Keep in sync with your CSS heat classes
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
})();
