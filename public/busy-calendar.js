// busy-calendar.js — builds World Holiday Calendar (Busiest Dates)

(function () {
  // --- Dynamic YEAR (same logic as rest of app) ---
  const yParam = Number(new URLSearchParams(location.search).get('year'));
  const YEAR = Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
    ? yParam
    : new Date().getFullYear();

  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  const yearEl = document.querySelector('#busy .cal-year');
  if (!yearEl) return;

  // --- Build lookup: dateStr (YYYY-MM-DD) → count of countries ---
  const countsByDate = {};
  for (const [iso2, rec] of Object.entries(TOTALS || {})) {
    if (!rec?.days) continue;
    for (const d of rec.days) {
      const dateStr = d.date; // already in YYYY-MM-DD
      if (!dateStr.startsWith(String(YEAR))) continue; // only this year
      countsByDate[dateStr] = (countsByDate[dateStr] || 0) + 1;
    }
  }

  // Utility: is this today?
  const isToday = (y, m, d) => {
    const t = new Date();
    return y === t.getFullYear() && m === t.getMonth() && d === t.getDate();
  };

  // --- Function to map count → bin class ---
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

  // --- Build each month ---
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
    const startDow = first.getDay(); // 0=Sun
    const daysInMonth = new Date(YEAR, m + 1, 0).getDate();

    // Leading blanks
    for (let i = 0; i < startDow; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day is-empty';
      grid.appendChild(empty);
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';

      if (isToday(YEAR, m, d)) btn.classList.add('is-today');

      const dateStr = `${YEAR}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const count = countsByDate[dateStr] || 0;

      btn.classList.add(countToBin(count));
      btn.title = `${monthNames[m]} ${d} — ${count} ${count === 1 ? 'country' : 'countries'} celebrate`;

      const span = document.createElement('span');
      span.className = 'cal-day__num';
      span.textContent = d;
      btn.appendChild(span);

      grid.appendChild(btn);
    }

    sec.appendChild(grid);
    yearEl.appendChild(sec);
  }
})();
