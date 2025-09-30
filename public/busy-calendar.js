// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Drop-in: no edits elsewhere except dispatching `totals-ready` in app.js when TOTALS is filled.

(function () {
  let initialized = false;

  // Kickoff when DOM is ready and when TOTALS is ready
  document.addEventListener('DOMContentLoaded', tryStart);
  document.addEventListener('totals-ready', tryStart);

  function tryStart() {
    if (initialized) return;
    const host = document.querySelector('#busy .cal-year');
    if (!host) return; // section not on page
    if (!window.TOTALS || !Object.keys(window.TOTALS).length) return; // data not ready yet
    initialized = true;
    initBusyCalendar(host, window.TOTALS);
  }

  function initBusyCalendar(host, TOTALS) {
    const YEAR = getYearParam();
    const { countsByDate, countriesByDate } = buildDateCounts(TOTALS, YEAR);
    renderHeatCalendar(host, YEAR, countsByDate, countriesByDate);
  }

  // -------- helpers --------

  function getYearParam() {
    const yParam = Number(new URLSearchParams(location.search).get('year'));
    return Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
      ? yParam
      : new Date().getFullYear();
  }

  // Decide what “national/public” means in your data. Adjust if needed.
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

  // Reduce TOTALS to: dateStr → { count, countries[] }
  function buildDateCounts(TOTALS, YEAR) {
    const countsByDate = Object.create(null);
    const countriesByDate = Object.create(null);

    for (const [iso2, rec] of Object.entries(TOTALS || {})) {
      const countryName = rec?.name || iso2;
      const days = Array.isArray(rec?.days) ? rec.days : [];
      for (const day of days) {
        const dateStr = String(day?.date || ''); // expect YYYY-MM-DD
        if (!dateStr.startsWith(String(YEAR))) continue;
        if (!isNationalHoliday(day)) continue;

        countsByDate[dateStr] = (countsByDate[dateStr] || 0) + 1;
        (countriesByDate[dateStr] ||= []).push(countryName);
      }
    }
    return { countsByDate, countriesByDate };
  }

  // Map count → heat bin class (keep in sync with your CSS)
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
    return 'heat-b9'; // 60+
  }

  function renderHeatCalendar(host, YEAR, countsByDate, countriesByDate) {
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ];
    const isToday = (y, m, d) => {
      const t = new Date();
      return y === t.getFullYear() && m === t.getMonth() && d === t.getDate();
    };

    host.innerHTML = '';

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
      const startDow = first.getDay(); // 0=Sun..6=Sat
      const daysInMonth = new Date(YEAR, m + 1, 0).getDate();

      // Leading blanks
      for (let i = 0; i < startDow; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day is-empty';
        grid.appendChild(empty);
      }

      // Days
      for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-day';
        if (isToday(YEAR, m, d)) btn.classList.add('is-today');

        const dateStr = `${YEAR}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = countsByDate[dateStr] || 0;

        btn.classList.add(countToBin(count));
        btn.dataset.count = String(count);
        btn.title = `${monthNames[m]} ${d} — ${count} ${count === 1 ? 'country' : 'countries'} celebrate`;

        const span = document.createElement('span');
        span.className = 'cal-day__num';
        span.textContent = d;
        btn.appendChild(span);

        // Optional: store countries for richer tooltip later
        const list = countriesByDate[dateStr];
        if (list && list.length) btn.dataset.countries = list.join(', ');

        grid.appendChild(btn);
      }

      sec.appendChild(grid);
      host.appendChild(sec);
    }
  }
})();
