// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Builds a full-year grid and heat-shades each date by # of countries with a NATIONAL/PUBLIC holiday.
// Uses your existing CSS classes: .year-cal, .cal-month, h4, .cal-dow, .cal-grid, .cal-day
// Drop-in replacement (combines your file + the improved helpers).

(function () {
  'use strict';

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
        if (applyHeatIfAvailable(YEAR) || ++tries > 40) clearInterval(timer);
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
    if (!window.TOTALS || !Object.keys(window.TOTALS).length) return false;
    const counts = tallyCounts(window.TOTALS, YEAR);
    colorize(counts);
    return true;
  }

  // Reduce TOTALS -> { 'YYYY-MM-DD': count } for NATIONAL/PUBLIC days only
  function tallyCounts(TOTALS, YEAR) {
    const map = Object.create(null);

    for (const [, rec] of Object.entries(TOTALS)) {
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const day of days) {
        const dateStr = normalizeDate(day);
        if (!dateStr || !dateStr.startsWith(String(YEAR))) continue;
        if (!isNational(day)) continue; // keep your strict nationwide/public intent

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

  // Normalize to 'YYYY-MM-DD' (supports {date}, {observed}, {iso}, {datetime})
  function normalizeDate(day) {
    // Exact strings
    if (day?.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) return day.date;
    if (day?.observed && /^\d{4}-\d{2}-\d{2}$/.test(day.observed)) return day.observed;

    // Try to parse common alt fields
    const raw = day?.date || day?.observed || day?.iso || day?.datetime;
    if (!raw) return null;
    const dt = new Date(raw);
    if (isNaN(dt)) return null;

    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Nationwide/public filter (covers Nager, Calendarific, and generic pipeline fields)
  function isNational(day) {
    // Nager: global === true means nationwide; counties listed => regional only
    if (day?.global === true) return true;
    if (Array.isArray(day?.counties) && day.counties.length > 0) return false;

    // Calendarific / mixed: type(s) may include 'National holiday' or 'Public'
    const typesJoined = Array.isArray(day?.types) ? day.types.join(' ') : (day?.type || day?.holidayType || '');
    const t = String(typesJoined).toLowerCase();

    // Generic fields your pipeline might set
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    if (scope.includes('national')) return true;

    // Some sources store a boolean
    if (day?.national === true) return true;

    // Fallback text match
    return t.includes('national') || t.includes('public');
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
