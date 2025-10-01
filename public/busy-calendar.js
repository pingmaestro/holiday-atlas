// busy-calendar.js — World Holiday Calendar (Busiest Dates)
// Builds a full-year grid and heat-shades each date by # of countries with a NATIONAL/PUBLIC holiday.
// Also supports dynamic heat scaling (handles 0..100+) and continent filters.
//
// Uses your existing CSS classes: .year-cal, .cal-month, h4, .cal-dow, .cal-grid, .cal-day
// Heat classes expected: .heat-b0 … .heat-b9  and .holiday

(function () {
  'use strict';

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const HEAT   = ['heat-b0','heat-b1','heat-b2','heat-b3','heat-b4','heat-b5','heat-b6','heat-b7','heat-b8','heat-b9'];

  const QS = new URLSearchParams(location.search);
  const FORCE_DEBUG = QS.get('debug') === '1';

  // ---- Dynamic scale state ----
  let BREAKS = [1,4,9,14,19,29,39,59,60]; // default (legacy-ish); recomputed after first counts
  function deriveBreaks(max) {
    // If the max is modest, keep your legacy-ish comfort bins.
    if (!Number.isFinite(max) || max <= 60) return [1,4,9,14,19,29,39,59,60];

    // For higher maxima, extend the tail so the top dates (e.g., Xmas ~100+) stand out.
    // Keep lower bins stable (so light greens are comparable), stretch high bins relative to max.
    const b6 = Math.max(29, Math.round(max * 0.35)); // start of stronger oranges
    const b7 = Math.max(39, Math.round(max * 0.50));
    const b8 = Math.max(59, Math.round(max * 0.70));
    const b9 = Math.max(60, Math.ceil (max * 0.90)); // dark red ~ top 10%
    return [1,4,9,14,19, b6, b7, b8, b9];
  }

  function countToBinDynamic(n) {
    if (n <= 0) return 'heat-b0';
    const [b1,b2,b3,b4,b5,b6,b7,b8,b9] = BREAKS;
    if (n <= b1) return 'heat-b1';
    if (n <= b2) return 'heat-b2';
    if (n <= b3) return 'heat-b3';
    if (n <= b4) return 'heat-b4';
    if (n <= b5) return 'heat-b5';
    if (n <= b6) return 'heat-b6';
    if (n <= b7) return 'heat-b7';
    if (n <= b8) return 'heat-b8';
    // > b8 (into top ~10%) -> b9
    return 'heat-b9';
  }

  // ---- Continent filtering state ----
  const ALL_CONTINENTS = ['Africa','Asia','Europe','North America','South America','Oceania'];
  let SELECTED_CONTINENTS = new Set(ALL_CONTINENTS); // "All" by default
  const CONTINENT_MAP = new Map(); // ISO2 -> Continent (filled from window if available)

  // We also keep an index so we can filter by continent without refetching:
  // date -> Set(ISO2)
  const DATE_INDEX = new Map();
  let CURRENT_COUNTS = {}; // last seen unfiltered counts (for fallback when no continent map)

  // UI refs
  let filtersEl = null;

  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('#busy .year-cal') || ensureHost();
    if (!host) return;

    const YEAR = getYear();
    buildCalendar(host, YEAR);

    // NEW: hover tooltip for day sums
    wireCalendarHover();

    // Try immediately; otherwise wait/poll for TOTALS to exist
    if (!bootstrap(YEAR)) {
      document.addEventListener('totals-ready', () => bootstrap(YEAR));
      let tries = 0;
      const t = setInterval(() => {
        if (bootstrap(YEAR) || ++tries > 60) clearInterval(t); // ~30s
      }, 500);
    }
  });

  // ---------------------- Boot flow ----------------------
  function bootstrap(YEAR) {
    ingestContinentMap(); // load continent map if app.js exposed it
    maybeRenderFilters(); // show/hide filters based on availability

    const totals = window.TOTALS;
    if (!totals || !Object.keys(totals).length) {
      showDebug({year: YEAR, note: 'TOTALS not ready or empty.', counts: {}, stage: 'waiting'});
      return false;
    }

    // First, try to color using in-memory TOTALS if it already carries per-day arrays.
    const directCountsStrict = buildCountsFromTotals(totals, YEAR, /*permissive=*/false);
    const directCountsPerm   = Object.keys(directCountsStrict).length ? directCountsStrict
                                 : buildCountsFromTotals(totals, YEAR, /*permissive=*/true);

    if (sumValues(directCountsPerm) > 0) {
      CURRENT_COUNTS = directCountsPerm;
      BREAKS = deriveBreaks(maxValue(CURRENT_COUNTS));
      repaint(); // will color using filter (if any)
      showDebug(summary(CURRENT_COUNTS, YEAR, {
        mode: directCountsPerm === directCountsStrict ? 'Strict' : 'Permissive',
        stage:'direct',
        note: scaleNote()
      }));
      return true;
    }

    // If TOTALS doesn't have day lists (usual in your pipeline), hydrate per-day via /api/holidayDetails
    hydrateFromApi(YEAR, totals).catch(()=>{});
    return true; // Calendar is built; hydration will paint progressively
  }

  // ---------------------- DOM helpers ----------------------
  function ensureHost() {
    const card = document.querySelector('#busy .card');
    if (!card) return null;
    const div = document.createElement('div');
    div.className = 'year-cal';
    card.appendChild(div);

    // Filters bar (invisible until we have a continent map)
    const filters = document.createElement('div');
    filters.className = 'busy-filters';
    filters.style.cssText = 'display:none; gap:6px; margin:8px 0 4px; flex-wrap:wrap; align-items:center;';
    filters.innerHTML = `
      <div style="font:12px/1.2 system-ui; color:#374151; margin-right:6px;">Filter:</div>
      <button type="button" class="bf-btn on" data-cont="__ALL__">All</button>
      <button type="button" class="bf-btn" data-cont="Africa">Africa</button>
      <button type="button" class="bf-btn" data-cont="Asia">Asia</button>
      <button type="button" class="bf-btn" data-cont="Europe">Europe</button>
      <button type="button" class="bf-btn" data-cont="North America">North America</button>
      <button type="button" class="bf-btn" data-cont="South America">South America</button>
      <button type="button" class="bf-btn" data-cont="Oceania">Oceania</button>
    `;
    // minimal styles for buttons
    filters.querySelectorAll('.bf-btn').forEach(b=>{
      b.style.cssText = 'font:12px/1 system-ui; padding:6px 8px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer;';
    });
    card.insertBefore(filters, div);
    filtersEl = filters;

    // debug panel shell
    const dbg = document.createElement('div');
    dbg.className = 'busy-debug';
    dbg.style.cssText = 'margin-top:8px;font:12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;color:#374151;';
    card.appendChild(dbg);
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

    // Wire filter click once we know host exists
    if (filtersEl) {
      filtersEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.bf-btn');
        if (!btn) return;
        filtersEl.querySelectorAll('.bf-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');

        const tag = btn.dataset.cont;
        if (tag === '__ALL__') {
          SELECTED_CONTINENTS = new Set(ALL_CONTINENTS);
        } else {
          SELECTED_CONTINENTS = new Set([tag]);
        }
        repaint();
      });
    }
  }

  // ---------------------- Direct-from-TOTALS path ----------------------
  function buildCountsFromTotals(TOTALS, YEAR, permissive) {
    const map = Object.create(null);

    for (const [iso2, rec] of Object.entries(TOTALS)) {
      const days = findYearDays(rec, YEAR);
      if (!days.length) continue;

      for (const day of days) {
        const dateStr = normalizeDate(day);
        if (!dateStr || !String(dateStr).startsWith(String(YEAR))) continue;
        if (!permissive && !isNational(day)) continue;

        map[dateStr] = (map[dateStr] || 0) + 1;
        addToIndex(iso2, dateStr);
      }
    }
    return map;
  }

  function findYearDays(rec, YEAR) {
    if (!rec) return [];
    if (Array.isArray(rec.days))      return rec.days;
    if (Array.isArray(rec.holidays))  return rec.holidays;
    if (Array.isArray(rec.list))      return rec.list;
    if (Array.isArray(rec.items))     return rec.items;
    if (Array.isArray(rec.data))      return rec.data;
    if (rec.daysByYear && Array.isArray(rec.daysByYear[YEAR])) return rec.daysByYear[YEAR];
    if (rec.byYear     && Array.isArray(rec.byYear[YEAR]))     return rec.byYear[YEAR];
    if (Array.isArray(rec[YEAR])) return rec[YEAR];

    // last resort: collect arrays from values & keep the ones matching YEAR
    const candidates = [];
    for (const v of Object.values(rec)) if (Array.isArray(v)) candidates.push(...v);
    return candidates.filter(x => {
      const ds = normalizeDate(x);
      return ds && String(ds).startsWith(String(YEAR));
    });
  }

  // ---------------------- Hydrate-from-API path ----------------------
  async function hydrateFromApi(YEAR, totals) {
    const iso2s = Object.keys(totals || {}).map(s => String(s).toUpperCase()).filter(k => k.length === 2);
    const cacheKey = `wcal:${YEAR}:v1`;
    const cached = sessionStorage.getItem(cacheKey);

    // Fast path: session cache
    if (cached) {
      try {
        const counts = JSON.parse(cached) || {};
        if (sumValues(counts) > 0) {
          CURRENT_COUNTS = counts;
          BREAKS = deriveBreaks(maxValue(CURRENT_COUNTS));
          repaint();
          showDebug(summary(counts, YEAR, {mode:'Strict', stage:'cache', note: scaleNote(true)}));
          return;
        }
      } catch { /* ignore bad cache */ }
    }

    // Progressive build with a small worker pool
    const counts = Object.create(null);
    let processed = 0;
    const POOL = 8;
    let i = 0;

    showDebug({year: YEAR, stage:'fetch', mode:'Strict', progress: `0 / ${iso2s.length}`, nonZeroDays: 0, max: 0, top: [], note: scaleNote(true)});

    async function worker() {
      while (i < iso2s.length) {
        const iso2 = iso2s[i++];
        try {
          const url = `/api/holidayDetails?iso2=${iso2}&year=${YEAR}`;
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          const list = Array.isArray(j.holidays) ? j.holidays : [];

          for (const day of list) {
            const dateStr = normalizeDate(day);
            if (!dateStr || !dateStr.startsWith(String(YEAR))) continue;
            if (!isNational(day)) continue; // strict by default
            counts[dateStr] = (counts[dateStr] || 0) + 1;
            addToIndex(iso2, dateStr);
          }
        } catch {
          // ignore this iso2 on failure
        } finally {
          processed++;
          if (processed % 6 === 0 || processed === iso2s.length) {
            CURRENT_COUNTS = counts;
            BREAKS = deriveBreaks(maxValue(CURRENT_COUNTS));
            repaint(); // incremental paint under current filter
            showDebug(summary(counts, YEAR, {mode:'Strict', stage:'fetch', progress: `${processed} / ${iso2s.length}`, note: scaleNote()}));
          }
        }
      }
    }

    await Promise.all(Array.from({length: POOL}, worker));

    // If still empty, do a permissive pass (count all holidays regardless of metadata)
    if (sumValues(counts) === 0) {
      let processed2 = 0;
      showDebug({year: YEAR, stage:'fetch', mode:'Permissive', note:'No national/public flags found; counting all holidays.', progress:`0 / ${iso2s.length}`});
      const countsAll = Object.create(null);
      i = 0;

      async function worker2() {
        while (i < iso2s.length) {
          const iso2 = iso2s[i++];
          try {
            const r = await fetch(`/api/holidayDetails?iso2=${iso2}&year=${YEAR}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(String(r.status));
            const j = await r.json();
            const list = Array.isArray(j.holidays) ? j.holidays : [];
            for (const day of list) {
              const dateStr = normalizeDate(day);
              if (!dateStr || !dateStr.startsWith(String(YEAR))) continue;
              countsAll[dateStr] = (countsAll[dateStr] || 0) + 1;
              addToIndex(iso2, dateStr);
            }
          } catch { /* ignore */ }
          finally {
            processed2++;
            if (processed2 % 6 === 0 || processed2 === iso2s.length) {
              CURRENT_COUNTS = countsAll;
              BREAKS = deriveBreaks(maxValue(CURRENT_COUNTS));
              repaint();
              showDebug(summary(countsAll, YEAR, {mode:'Permissive', stage:'fetch', progress: `${processed2} / ${iso2s.length}`, note: scaleNote()}));
            }
          }
        }
      }
      await Promise.all(Array.from({length: POOL}, worker2));

      if (sumValues(countsAll) > 0) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(countsAll)); } catch {}
      }
      return;
    }

    // cache strict if non-empty
    try { sessionStorage.setItem(cacheKey, JSON.stringify(counts)); } catch {}
  }

  // ---------------------- Repaint with filter ----------------------
  function repaint() {
    // If we don't have a continent map or the filter is ALL, just apply CURRENT_COUNTS.
    if (!CONTINENT_MAP.size || SELECTED_CONTINENTS.size === ALL_CONTINENTS.length) {
      applyColors(CURRENT_COUNTS);
      return;
    }

    // Build filtered counts: for each date, count only countries in selected continents.
    const filtered = Object.create(null);
    for (const [date, isoSet] of DATE_INDEX.entries()) {
      let n = 0;
      for (const iso2 of isoSet) {
        const cont = CONTINENT_MAP.get(iso2) || 'Other';
        if (SELECTED_CONTINENTS.has(cont)) n++;
      }
      if (n > 0) filtered[date] = n;
    }
    // Re-derive breaks from the filtered data so contrast stays good when narrowing.
    BREAKS = deriveBreaks(maxValue(filtered));
    applyColors(filtered);
  }

  // ---------------------- Paint ----------------------
  function applyColors(countsByDate) {
    const nodes = document.querySelectorAll('#busy .cal-day[data-date]');
    for (const el of nodes) {
      for (const h of HEAT) el.classList.remove(h);
      el.classList.remove('holiday');

      const date = el.dataset.date;
      const n = countsByDate[date] || 0;

      if (n > 0) el.classList.add('holiday'); // ring (no fill) per your CSS
      el.classList.add(countToBinDynamic(n)); // dynamic heat color

      // Tooltip & a11y
      el.dataset.count = String(n);
      const label = `${n} national ${n === 1 ? 'holiday' : 'holidays'} on ${fmtDateLong(date)}`;
      el.setAttribute('aria-label', label);
      el.title = label;
      if (WCAL_TIP.current === el) WCAL_TIP.update(label);
    }
  }

  // ---------------------- Helpers ----------------------
  function addToIndex(iso2, dateStr) {
    const k = String(iso2 || '').toUpperCase().slice(0,2);
    if (!k || !dateStr) return;
    let set = DATE_INDEX.get(dateStr);
    if (!set) { set = new Set(); DATE_INDEX.set(dateStr, set); }
    set.add(k);
  }

  function ingestContinentMap() {
    const m = window.haContinentByIso2 || window.continentByIso2 || null;
    if (!m || typeof m !== 'object') return;
    for (const [k,v] of Object.entries(m)) {
      const iso2 = String(k).toUpperCase();
      const cont = String(v || '').trim();
      if (iso2.length === 2 && cont) CONTINENT_MAP.set(iso2, cont);
    }
  }

  function maybeRenderFilters() {
    if (!filtersEl) return;
    // Show only if we have a useful map
    filtersEl.style.display = CONTINENT_MAP.size ? 'flex' : 'none';
  }

  function normalizeDate(day) {
    if (day == null) return null;

    // raw string/number/Date
    if (typeof day === 'string' || typeof day === 'number' || day instanceof Date) {
      const dt = new Date(day);
      if (isNaN(dt)) return null;
      return ymd(dt);
    }

    // objects from /api/holidayDetails likely have { date:'YYYY-MM-DD', global:true }
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
    // Nager: global === true means nationwide; counties listed => regional only
    if (day && typeof day === 'object') {
      if (day.global === true) return true;
      if (Array.isArray(day.counties) && day.counties.length > 0) return false;
    }
    // Calendarific/mixed: type(s) may include 'National holiday' or 'Public'
    const typesJoined = Array.isArray(day?.types) ? day.types.join(' ') : (day?.type || day?.holidayType || '');
    const t = String(typesJoined).toLowerCase();

    // Generic scope/level
    const scope = String(day?.scope || day?.level || '').toLowerCase();
    if (scope.includes('national')) return true;

    if (day?.national === true) return true;
    if (t.includes('national') || t.includes('public')) return true;

    return false;
  }

  function fmtDate(yyyyMmDd) {
    const [y,m,d] = yyyyMmDd.split('-').map(Number);
    return `${MONTHS[m-1]} ${d}`;
  }
  function fmtDateLong(yyyyMmDd) {
    const [y,m,d] = yyyyMmDd.split('-').map(Number);
    return `${MONTHS[m-1]} ${d}, ${y}`;
  }

  function sumValues(obj) { let s = 0; for (const v of Object.values(obj)) s += v || 0; return s; }
  function maxValue(obj) { let m = 0; for (const v of Object.values(obj)) if ((v||0) > m) m = v||0; return m; }

  function summary(counts, YEAR, {mode='Strict', stage='direct', progress='', note} = {}) {
    const vals = Object.entries(counts);
    vals.sort((a,b) => b[1]-a[1]);
    const nonZero = vals.filter(([,n]) => n>0);
    const max = nonZero.length ? nonZero[0][1] : 0;
    const top = nonZero.slice(0,12);
    return {
      year: YEAR,
      mode,
      stage,
      progress,
      max,
      nonZeroDays: nonZero.length,
      sampleDomDate: (document.querySelector('#busy .cal-day[data-date]') || {}).dataset?.date || '(none)',
      top,
      note: note || scaleNote()
    };
  }

  function scaleNote(fromCache=false) {
    const [b1,b2,b3,b4,b5,b6,b7,b8,b9] = BREAKS;
    return `Scale${fromCache?' (cached)':''}: 1, ≤${b2}, ≤${b3}, ≤${b4}, ≤${b5}, ≤${b6}, ≤${b7}, ≤${b8}, >${b8}`;
  }

  function showDebug(info) {
    const dbg = document.querySelector('.busy-debug');
    if (!dbg) return;

    const shouldShow = FORCE_DEBUG || info.stage !== 'direct' || info.nonZeroDays === 0 || info.note || info.progress;
    if (!shouldShow) { dbg.innerHTML = ''; return; }

    const header = `
      <div style="padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa">
        <div style="font-weight:600;margin-bottom:6px">World Holiday Calendar — Debug</div>
        <div>Year: <b>${info.year}</b> • Mode: <b>${info.mode}</b> • Stage: <b>${info.stage}</b>${info.progress ? ` • Progress: <b>${info.progress}</b>` : ''}</div>
        <div>Days with ≥1 holiday: <b>${info.nonZeroDays||0}</b> • Max/day: <b>${info.max||0}</b></div>
        <div>${info.note ? info.note : ''}</div>
        <div style="margin-top:4px;color:#6b7280">DOM sample day: <code>${info.sampleDomDate || ''}</code></div>
        ${Array.isArray(info.top) && info.top.length ? renderTop(info.top) : '<div style="margin-top:6px;">No non-zero dates yet.</div>'}
        <div style="margin-top:6px;color:#6b7280">Tip: add <code>?debug=1</code> to always show this panel.</div>
      </div>
    `;
    dbg.innerHTML = header;

    function renderTop(top) {
      const rows = top.map(([d,n]) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${fmtDate(d)}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee;">${n}</td></tr>`).join('');
      return `<div style="margin-top:8px">
        <div style="font-weight:600;margin-bottom:4px">Top dates</div>
        <table style="border-collapse:collapse;width:auto;min-width:240px">${rows}</table>
      </div>`;
    }
  }

  /* ---------------- Tooltip (hover/focus) ---------------- */
  const WCAL_TIP = {
    el: null,
    current: null,
    ensure() {
      if (this.el) return this.el;
      const t = document.createElement('div');
      t.className = 'wcal-tip';
      t.style.cssText = `
        position:absolute; transform:translate(-50%,-6px);
        padding:6px 8px; border-radius:8px; font:12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        background:#111; color:#fff; box-shadow:0 2px 10px rgba(0,0,0,.12);
        pointer-events:none; z-index:9999; white-space:nowrap;
      `;
      t.hidden = true;
      document.body.appendChild(t);
      this.el = t;
      return t;
    },
    showFor(el) {
      const t = this.ensure();
      const txt = el.getAttribute('aria-label') || `${el.dataset.count || 0} national holidays on ${fmtDateLong(el.dataset.date)}`;
      this.update(txt);
      const r = el.getBoundingClientRect();
      t.style.left = Math.round(window.scrollX + r.left + r.width/2) + 'px';
      t.style.top  = Math.round(window.scrollY + r.top) + 'px';
      t.hidden = false;
      this.current = el;
    },
    update(txt) { if (this.el) this.el.textContent = txt; },
    hide() { if (this.el) this.el.hidden = true; this.current = null; }
  };

  function wireCalendarHover() {
    const root = document.querySelector('#busy');
    if (!root) return;

    root.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.cal-day[data-date]');
      if (cell) WCAL_TIP.showFor(cell);
    });
    root.addEventListener('mouseout', (e) => {
      const from = e.target.closest('.cal-day[data-date]');
      const to   = e.relatedTarget && e.relatedTarget.closest?.('.cal-day[data-date]');
      if (from && from !== to) WCAL_TIP.hide();
    });
    root.addEventListener('focusin', (e) => {
      const cell = e.target.closest('.cal-day[data-date]');
      if (cell) WCAL_TIP.showFor(cell);
    });
    root.addEventListener('focusout', () => WCAL_TIP.hide());
    window.addEventListener('scroll', () => WCAL_TIP.hide(), { passive: true });
  }
})();
