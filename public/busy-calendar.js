// busy-calendar.js — Busiest Dates calendar using your existing .year-cal UI

(function () {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const HEAT = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('#busy .year-cal, #busy .cal-year') || ensureHost();
    if (!host) return;

    const YEAR = getYear();
    buildCalendar(host, YEAR);          // always render the grid
    applyHeatIfAvailable(YEAR);         // paint now if TOTALS is ready
    // react fast if app.js dispatches totals-ready
    document.addEventListener('totals-ready', () => applyHeatIfAvailable(YEAR));
    // fallback polling if no event is dispatched
    let tries = 0, t = setInterval(() => {
      if (applyHeatIfAvailable(YEAR) || ++tries > 40) clearInterval(t);
    }, 500);
  });

  function ensureHost() {
    const card = document.querySelector('#busy .card');
    if (!card) return null;
    const div = document.createElement('div');
    div.className = 'year-cal'; // uses your CSS
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

      const h = document.createElement('h4');
      h.textContent = `${MONTHS[m]} ${YEAR}`;
      sec.appendChild(h);

      const dow = document.createElement('div');
      dow.className = 'cal-dow';
      dow.textContent = 'S  M  T  W  T  F  S';
      sec.appendChild(dow);

      const grid = document.createElement('div');
      grid.className = 'cal-grid';

      const first = new Date(YEAR, m, 1);
      const startDow = first.getDay(); // 0..6 (Sun..Sat)
      const daysInMonth = new Date(YEAR, m + 1, 0).getDate();

      // leading blanks
      for (let i = 0; i < startDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day muted';
        blank.textContent = '';
        grid.appendChild(blank);
      }

      // actual days
      for (let d = 1; d <= daysInMonth; d++) {
        const el = document.createElement('div');
        el.className = 'cal-day heat-b0'; // neutral by default
        el.dataset.date = `${YEAR}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        el.textContent = d;

        // today highlight (your CSS uses .today)
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

  function applyHeatIfAvailable(YEAR) {
    if (!window.TOTALS || !Object.keys(window.TOTALS).length) return false;

    const counts = tallyCounts(window.TOTALS, YEAR);
    const days = document.querySelectorAll('#busy .cal-day[data-date]');
    for (const el of days) {
      // wipe any prior heat class
      for (const h of HEAT) el.classList.remove(h);

      const date = el.dataset.date;
      const n = counts[date] || 0;
      el.classList.add(countToBin(n));
      el.title = `${fmtDate(date)} — ${n} ${n === 1 ? 'country' : 'countries'} celebrate`;
    }
    return true;
  }

  function tallyCounts(TOTALS, YEAR) {
    const map = Object.create(null);
    for (const [, rec] of Object.entries(TOTALS)) {
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const d of days) {
        const ds = String(d?.date || '');
        if (!ds.startsWith(String(YEAR))) continue;
        if (!isNational(d)) continue;
        map[ds] = (map[ds] || 0) + 1;
      }
    }
    return map;
  }

  // Adjust if your fields differ
  function isNational(day) {
    const t = String(day?.type || day?.types || '').toLowerCase();
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    return day?.national === true || scope.includes('national') || t.includes('national') || t.includes('public');
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
})();
