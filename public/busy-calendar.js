// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Uses your existing CSS classes: .year-cal, .cal-month, h4, .cal-dow, .cal-grid, .cal-day

(function () {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const HEAT = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  // Build calendar on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('#busy .year-cal') || ensureHost();
    if (!host) return;

    const YEAR = getYear();
    buildCalendar(host, YEAR);      // always render a full calendar first
    // Try to color now, then listen/poll for data
    if (!applyHeatIfAvailable(YEAR)) {
      document.addEventListener('totals-ready', () => applyHeatIfAvailable(YEAR));
      let tries = 0, timer = setInterval(() => {
        if (applyHeatIfAvailable(YEAR) || ++tries > 40) clearInterval(timer);
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

      // Month title uses <h4> to match your CSS
      const h4 = document.createElement('h4');
      h4.textContent = `${MONTHS[m]} ${YEAR}`;
      sec.appendChild(h4);

      // Weekday header (no SMTWTFS in HTML; we generate 7 cells)
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

      // leading blanks to align first day
      for (let i = 0; i < startDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day muted';
        grid.appendChild(blank);
      }

      // actual days
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

  function applyHeatIfAvailable(YEAR) {
    if (!window.TOTALS || !Object.keys(window.TOTALS).length) return false;
    const counts = tallyCounts(window.TOTALS, YEAR);
    colorize(counts);
    return true;
    }

  function tallyCounts(TOTALS, YEAR) {
    const map = Object.create(null);
    for (const [, rec] of Object.entries(TOTALS)) {
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const day of days) {
        const ds = String(day?.date || '');
        if (!ds.startsWith(String(YEAR))) continue;
        if (!isNational(day)) continue;
        map[ds] = (map[ds] || 0) + 1;
      }
    }
    return map;
  }

  // Match your "national/public" filter; tweak if your data uses other fields
  function isNational(day) {
    const t = String(day?.type || day?.types || '').toLowerCase();
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    return day?.national === true || scope.includes('national') || t.includes('national') || t.includes('public');
  }

  function colorize(countsByDate) {
    const nodes = document.querySelectorAll('#busy .cal-day[data-date]');
    for (const el of nodes) {
      // clear old heat + holiday
      for (const h of HEAT) el.classList.remove(h);
      el.classList.remove('holiday');

      const date = el.dataset.date;
      const n = countsByDate[date] || 0;

      if (n > 0) el.classList.add('holiday'); // use your pretty holiday badge style
      el.classList.add(countToBin(n));

      el.title = `${fmtDate(date)} — ${n} ${n === 1 ? 'country' : 'countries'} celebrate`;
    }
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
