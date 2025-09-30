(function () {
  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const HEAT = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  // Build the calendar as soon as DOM is ready
  document.addEventListener('DOMContentLoaded', init);
  // If app.js fires an event when data is ready, we’ll recolor immediately
  document.addEventListener('totals-ready', applyHeatIfAvailable);

  // Fallback: light polling in case you don’t dispatch totals-ready
  let pollId = null, tries = 0, MAX_TRIES = 40; // ~20s max
  function startPolling() {
    if (pollId) return;
    pollId = setInterval(() => {
      if (applyHeatIfAvailable() || ++tries >= MAX_TRIES) {
        clearInterval(pollId); pollId = null;
      }
    }, 500);
  }

  function init() {
    const host = document.querySelector('#busy .cal-year');
    if (!host) return;

    const YEAR = getYear();
    buildFullCalendar(host, YEAR);     // ✅ always render the full calendar (no data needed)
    if (!applyHeatIfAvailable()) {     // try to color now…
      startPolling();                  // …or wait briefly for TOTALS
    }
  }

  function getYear() {
    const y = Number(new URLSearchParams(location.search).get('year'));
    return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : new Date().getFullYear();
  }

  function buildFullCalendar(host, YEAR) {
    host.innerHTML = ''; // overwrite any partial markup
    for (let m = 0; m < 12; m++) {
      const sec = document.createElement('section');
      sec.className = 'cal-month';
      sec.setAttribute('aria-label', monthNames[m]);

      const head = document.createElement('header');
      head.className = 'cal-month__head';
      head.innerHTML = `
        <h3 class="cal-month__name">${monthNames[m]} ${YEAR}</h3>
        <div class="cal-dow">S M T W T F S</div>
      `;
      sec.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'cal-grid';

      const first = new Date(YEAR, m, 1);
      const startDow = first.getDay();               // 0=Sun..6=Sat
      const daysInMonth = new Date(YEAR, m+1, 0).getDate();

      // Leading blanks to align the first day
      for (let i = 0; i < startDow; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-day is-empty';
        grid.appendChild(blank);
      }

      // Actual days
      for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-day heat-b0';           // neutral by default
        btn.dataset.date = yyyyMmDd(YEAR, m+1, d);   // saves YYYY-MM-DD
        btn.title = `${monthNames[m]} ${d} — 0 countries celebrate`;

        if (isToday(YEAR, m, d)) btn.classList.add('is-today');

        const n = document.createElement('span');
        n.className = 'cal-day__num';
        n.textContent = d;
        btn.appendChild(n);

        grid.appendChild(btn);
      }

      sec.appendChild(grid);
      host.appendChild(sec);
    }
  }

  function isToday(y, m, d) {
    const t = new Date();
    return y === t.getFullYear() && m === t.getMonth() && d === t.getDate();
  }
  function yyyyMmDd(y, m, d) {
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  // Try to apply heat if data exists; return true if applied
  function applyHeatIfAvailable() {
    if (!hasTotals()) return false;
    const YEAR = getYear();
    const countsByDate = buildCounts(window.TOTALS, YEAR);
    colorizeFromCounts(countsByDate, YEAR);
    return true;
  }

  function hasTotals() {
    return typeof window.TOTALS === 'object' && window.TOTALS && Object.keys(window.TOTALS).length > 0;
  }

  // Reduce TOTALS → dateStr -> count (national/public only)
  function buildCounts(TOTALS, YEAR) {
    const counts = Object.create(null);
    for (const [, rec] of Object.entries(TOTALS)) {
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const day of days) {
        const dateStr = String(day?.date || '');
        if (!dateStr.startsWith(String(YEAR))) continue;
        if (!isNationalHoliday(day)) continue;
        counts[dateStr] = (counts[dateStr] || 0) + 1;
      }
    }
    return counts;
  }

  // Tweak this if your fields differ
  function isNationalHoliday(day) {
    const t = String(day?.type || day?.types || '').toLowerCase();
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    return (
      day?.national === true ||
      scope.includes('national') ||
      t.includes('national') ||
      t.includes('public')
    );
  }

  function colorizeFromCounts(countsByDate, YEAR) {
    const days = document.querySelectorAll('#busy .cal-day:not(.is-empty)');
    for (const el of days) {
      // wipe old heat classes
      for (const cls of HEAT) el.classList.remove(cls);

      const dateStr = el.dataset.date;
      const count = countsByDate[dateStr] || 0;
      el.classList.add(countToBin(count));
      const d = Number(dateStr.slice(-2));
      const mIdx = Number(dateStr.slice(5,7)) - 1;
      el.title = `${monthNames[mIdx]} ${d} — ${count} ${count === 1 ? 'country' : 'countries'} celebrate`;
    }
  }

  // Keep in sync with your CSS
  function countToBin(count) {
    if (count === 0) return 'heat-b0';
    if (count === 1) return 'heat-b1';
    if (count <= 4) return 'heat-b2';
    if (count <= 9) return 'heat-b3';
    if (count <= 14) return 'heat-b4';
    if (count <= 19) return 'heat-b5';
    if (count <= 29) return 'heat-b6';
    if (count <= 39) return 'heat-b7';
    if (count <= 59) return 'heat-b8';
    return 'heat-b9';
  }
})();
