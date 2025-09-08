// Holiday Atlas app.js — YEAR views + List/Calendar (national-only) + Long Weekend tags/overlay

import { normalizeCodeList } from '/utils/country-codes.js';

function buildNameToIso2() {
  const map = new Map();
  for (const [iso2, rec] of Object.entries(TOTALS || {})) {
    if (rec?.name) map.set(String(rec.name).toLowerCase(), iso2);
  }
  return map;
}

(async function () {
  // ---- Dynamic YEAR with optional ?year= override ----
  const yParam = Number(new URLSearchParams(location.search).get('year'));
  const YEAR = Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
    ? yParam
    : new Date().getFullYear();

  // ---- Tiny HTML escaper ----
  const esc = s => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  // ---- Parse ISO (YYYY-MM-DD) as local Date (avoid UTC off-by-one) ----
  function parseLocalISODate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
      ? new Date(y, m - 1, d) // local midnight
      : new Date(iso);        // fallback
  }

  // ---- State ----
  let TOTALS = {};   // { FR:{ name, national, regional }, ... }
  let REGIONS = {};  // { FR:{ 'FR-75': n, ... }, ... }
  const detailsCache = new Map();      // key: "FR-2025" -> holidays[]
  const longWeekendCache = new Map();  // key: "FR-2025" -> { list, dateSet }
  let CURRENT_VIEW = 'all';            // 'all' or 'today'
  let CURRENT_MODE = 'list';           // 'list' or 'cal'
  let CURRENT_DETAILS = null;          // { iso2, displayName, holidays, regionCode }

  // ---- Elements ----
  const detailsTitle = document.getElementById('details-title');
  const detailsBody  = document.getElementById('details-body');
  const loadingEl    = document.getElementById('view-loading');

  // ---- Loader + cache helpers (Today view) ----
  let TODAY_CACHE = { at: 0, list: [] };
  const TODAY_TTL_MS = 10 * 60 * 1000;

  function setLoading(isLoading, label = 'Loading Today…') {
    if (!loadingEl) return;
    if (isLoading) {
      loadingEl.textContent = label;
      loadingEl.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    } else {
      loadingEl.hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  }

  // Detect user's IANA zone once
  const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
// Choose how "Today" works: 'global' (anchored to USER_TZ) or 'local'
  const TODAY_MODE = 'global'; // ← set to 'local' if you want per-country local dates

  async function fetchTodaySet(year) {
    const now = Date.now();
    if (now - TODAY_CACHE.at < TODAY_TTL_MS && TODAY_CACHE.list.length) {
      return TODAY_CACHE.list;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const params = new URLSearchParams({ year: String(year) });
      if (TODAY_MODE === 'global') {
        params.set('mode', 'global');
        params.set('tz', USER_TZ);
      } else {
        params.set('mode', 'local'); // explicit
      }

      const res = await fetch(`/api/todaySet?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);

      const raw = res.ok ? await res.json() : { today: [] };
      const arr = Array.isArray(raw.today) ? raw.today : [];

      // Normalize to ISO2 UPPER (safe)
      const norm = Array.from(new Set(arr.map(c => String(c).trim().toUpperCase().slice(0,2))));
      TODAY_CACHE = { at: now, list: norm };
      return norm;
    } catch {
      clearTimeout(timeout);
      return TODAY_CACHE.list || [];
    }
  }

  async function getCountryDetails(iso2) {
    const key = `${iso2}-${YEAR}`;
    if (detailsCache.has(key)) return detailsCache.get(key);
    try {
      const r = await fetch(`/api/holidayDetails?iso2=${iso2}&year=${YEAR}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      const list = Array.isArray(data.holidays) ? data.holidays : [];
      detailsCache.set(key, list);
      return list;
    } catch {
      detailsCache.set(key, []);
      return [];
    }
  }

  // ---- Long Weekend fetcher (Nager.Date) ----
  // API: https://date.nager.at/api/v3/LongWeekend/{year}/{countryCode}
  async function getLongWeekends(iso2, year) {
    const key = `${iso2}-${year}`;
    if (longWeekendCache.has(key)) return longWeekendCache.get(key);

    try {
      const url = `https://date.nager.at/api/v3/LongWeekend/${year}/${iso2}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json(); // [{ startDate, endDate, dayCount, needBridgeDay }, ...]
      // Build a Set of yyyy-mm-dd strings inside any LW range
      const dateSet = new Set();
      for (const lw of list) {
        const sd = parseLocalISODate(lw.startDate);
        const ed = parseLocalISODate(lw.endDate);
        for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          dateSet.add(`${y}-${m}-${dd}`);
        }
      }
      const payload = { list, dateSet };
      longWeekendCache.set(key, payload);
      return payload;
    } catch {
      const payload = { list: [], dateSet: new Set() };
      longWeekendCache.set(key, payload);
      return payload;
    }
  }

  // ---- Calendar renderer (12-month year grid) ----
  function renderCalendarHTML(year, holidays, longWeekendDates /* Set<string> yyyy-mm-dd */) {
    // Map yyyy-mm-dd -> [holiday names]
    const holidayMap = new Map();
    holidays.forEach(h => {
      const d = h.date;
      if (!holidayMap.has(d)) holidayMap.set(d, []);
      holidayMap.get(d).push(h.name || h.localName || 'Holiday');
    });

    // normalize "today" to local midnight
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const monthNames = Array.from({ length: 12 }, (_, i) =>
      new Date(year, i, 1).toLocaleString(undefined, { month: 'long' })
    );
    const dow = ['S','M','T','W','T','F','S']; // Sunday-start

    const months = monthNames.map((mn, mIdx) => {
      const first = new Date(year, mIdx, 1);
      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
      const startDOW = first.getDay();

      const blanks = Array.from({ length: startDOW }, () => `<div class="cal-day"></div>`);

      const days = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dLocal = new Date(year, mIdx, day);
        const yyyy = year;
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;

        const isHoliday = holidayMap.has(key);
        const isPast = dLocal < today;
        const inLW = longWeekendDates && longWeekendDates.has(key);

        const names = isHoliday ? holidayMap.get(key) : [];
        const longDate = dLocal.toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'long', day:'numeric' });

        // Tooltip text
        let tip = longDate;
        if (names.length) tip += ` — ${names.join(', ')}`;
        if (inLW) tip += names.length ? ' • Long Weekend' : ' — Long Weekend';

        const classes = [
          'cal-day',
          isHoliday ? 'holiday' : '',
          isPast ? 'past' : '',
          inLW ? 'lw' : ''
        ].filter(Boolean).join(' ');

        return `<div class="${classes}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" tabindex="0">${day}</div>`;
      });

      return `
        <section class="cal-month">
          <h4>${esc(mn)} ${year}</h4>
          <div class="cal-grid">
            ${dow.map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${blanks.join('')}${days.join('')}
          </div>
        </section>
      `;
    }).join('');

    return `<div class="year-cal">${months}</div>`;
  }

  // ---- Lightweight calendar tooltip (custom) ----
  let calTipEl = null;
  function ensureCalTip() {
    if (calTipEl) return calTipEl;
    calTipEl = document.createElement('div');
    calTipEl.className = 'cal-tip';
    calTipEl.setAttribute('role', 'tooltip');
    calTipEl.hidden = true;
    document.body.appendChild(calTipEl);
    return calTipEl;
  }
  function showCalTipFor(el) {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    const tip = ensureCalTip();
    tip.textContent = text;
    const r = el.getBoundingClientRect();
    tip.style.left = Math.round(window.scrollX + r.left + r.width / 2) + 'px';
    tip.style.top  = Math.round(window.scrollY + r.top - 8) + 'px';
    tip.hidden = false;
  }
  function hideCalTip() { if (calTipEl) calTipEl.hidden = true; }

  // Delegate events on the details body (works across re-renders)
  detailsBody.addEventListener('mouseover', (e) => {
    const day = e.target.closest('.cal-day');
    if (!day || !detailsBody.contains(day)) return;
    showCalTipFor(day);
  });
  detailsBody.addEventListener('mouseout', hideCalTip);
  detailsBody.addEventListener('focusin', (e) => {
    const day = e.target.closest('.cal-day');
    if (day) showCalTipFor(day);
  });
  detailsBody.addEventListener('focusout', hideCalTip);
  window.addEventListener('scroll', hideCalTip, { passive: true });

  // ---- Details renderer (List/Calendar) ----
  async function renderDetails(iso2, displayName, holidays, regionCode = null, mode = CURRENT_MODE) {
    CURRENT_DETAILS = { iso2, displayName, holidays, regionCode };

    // Only national holidays
    const all = Array.isArray(holidays) ? holidays : [];
    const natList = all.filter(h => h && h.global === true);

    // Fetch long weekends for the country-year
    const { dateSet: lwDates } = await getLongWeekends(iso2, YEAR);

    // Title (keeping your format here)
    const suffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${suffix} — Holidays (${YEAR})`;

    // Toggle the tab UI
    const btnList = document.getElementById('details-view-list');
    const btnCal  = document.getElementById('details-view-cal');
    if (btnList && btnCal) {
      btnList.classList.toggle('is-active', mode === 'list');
      btnList.setAttribute('aria-selected', mode === 'list' ? 'true' : 'false');
      btnCal.classList.toggle('is-active', mode === 'cal');
      btnCal.setAttribute('aria-selected', mode === 'cal' ? 'true' : 'false');
    }

    if (!natList.length) {
      detailsBody.innerHTML = `<div class="note">No national holidays available.</div>`;
      hideCalTip();
      return;
    }

    if (mode === 'cal') {
      detailsBody.innerHTML = renderCalendarHTML(YEAR, natList, lwDates);
      hideCalTip();
      return;
    }

    // LIST mode: date + holiday name (+ Long Week-End Alert pill when inside LW)
    const rows = natList
      .slice()
      .sort((a, b) => parseLocalISODate(a.date) - parseLocalISODate(b.date))
      .map(h => {
        const d = parseLocalISODate(h.date);
        const pretty = d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
        const nm = h.localName && h.localName !== h.name
          ? `${esc(h.name)} <span class="note">(${esc(h.localName)})</span>`
          : esc(h.name);

        const inLW = lwDates.has(h.date);
        const lwTag = inLW ? ` <span class="pill lw" title="This holiday falls within a long weekend">Long Week-End Alert</span>` : '';

        return `<div class="row two-cols">
          <div class="cell">${pretty}</div>
          <div class="cell">${nm}${lwTag}</div>
        </div>`;
      }).join('');

    detailsBody.innerHTML = `<div class="rows">${rows}</div>`;
    hideCalTip();
  }

  // ---- Region list card & click wiring ----
  function renderRegionList(iso2) {
    const anchor = document.getElementById('region-list-anchor');
    if (!anchor) return;

    let card = document.getElementById('region-list');
    if (!card) {
      card = document.createElement('article');
      card.id = 'region-list';
      card.className = 'card';
      card.innerHTML = `<div><strong>States / Provinces</strong></div><div class="rows" id="region-rows"></div>`;
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }

    const rows = document.getElementById('region-rows');
    const m = REGIONS[iso2] || {};
    const entries = Object.entries(m).sort((a,b) => b[1] - a[1]);

    if (!entries.length) {
      rows.innerHTML = `<div class="note">No regional breakdown available.</div>`;
      return;
    }

    rows.innerHTML = entries.map(([code, count]) => `
      <div class="row region-row" data-code="${esc(code)}" style="cursor:pointer">
        <div class="cell">${esc(code)}</div>
        <div class="cell"><span class="pill">${count} regional</span></div>
      </div>
    `).join('');

    rows.querySelectorAll('.region-row').forEach(el => {
      const code = el.getAttribute('data-code');
      el.title = `${code}: ${m[code]} regional holidays`;
      el.addEventListener('click', async (evt) => {
        evt.preventDefault();
        const holidays = detailsCache.get(`${iso2}-${YEAR}`) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        await renderDetails(iso2, countryName, holidays, code, CURRENT_MODE); // still national-only in panel
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
    });
  }

  // ---- Main init ----
  try {
    console.log("Holiday Atlas app.js — dynamic YEAR =", YEAR);

    // 1) Load totals JSON (cache-busted)
    const totalsRes = await fetch(`/data/totals-${YEAR}.json?v=${Date.now()}`, { cache: 'no-store' });
    const totalsJSON = await totalsRes.json();
    TOTALS  = totalsJSON.totals  || {};
    REGIONS = totalsJSON.regions || {};

    // 2) Build series data using hc-key (lowercased ISO2)
    const rows = Object.entries(TOTALS).map(([code, rec]) => [
      code.toLowerCase(),                              // hc-key
      Number.isFinite(rec?.national) ? rec.national : null,
      rec?.name || code
    ]);

    // 3) Load a high-res Robinson world map (crisper)
    const topology = await fetch('https://code.highcharts.com/mapdata/custom/world-robinson-highres.geo.json')
      .then(r => r.json());

    // 4) Render map
    const chart = Highcharts.mapChart('wpr-map', {
      chart: {
        map: topology,
        spacing: [0, 0, 0, 0],
        backgroundColor: 'transparent',
        animation: false
      },
      title: { text: null },
      credits: { enabled: true },
      accessibility: { enabled: false },

      exporting: {
        enabled: true,
        buttons: {
          contextButton: { align: 'right', verticalAlign: 'top', x: -8, y: 8, theme: { r: 0 } }
        }
      },

      // 🔒 Disable all zoom interactions/buttons
      mapNavigation: {
        enabled: false,
        enableButtons: false,
        enableMouseWheelZoom: false,
        enableDoubleClickZoomTo: false,
        enableDoubleClickZoom: false,
        enableTouchZoom: false
      },

      legend: {
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { fontSize: '12px' }
      },

      colorAxis: {
        dataClassColor: 'category',
        dataClasses: [
          { to: 4,              color: '#d9f2e3', name: '≤ 4' },
          { from: 5,  to: 7,    color: '#a9d9d8', name: '5-7' },
          { from: 8,  to: 10,   color: '#8cc7e4', name: '8-10' },
          { from: 11, to: 13,   color: '#6db3ea', name: '11-13' },
          { from: 14, to: 19,   color: '#4d9ae8', name: '14-19' },
          { from: 20,           color: '#0b3d91', name: '20+' }
        ],
        nullColor: '#d9d9d9',
        labels: { formatter: function() { return this.value ? Math.round(this.value) : this.value; } }
      },

      tooltip: {
        useHTML: true,
        headerFormat: '',
        followPointer: true,
        shadow: false,
        animation: false,
        hideDelay: 0,
        formatter: function () {
          const name = this.point.name || this.point.options?.label || (this.point.options && this.point.options['hc-key'] ? this.point.options['hc-key'].toUpperCase() : '');
          const val = (typeof this.point.value === 'number') ? this.point.value : null;

          if (CURRENT_VIEW === 'today') {
            return val === 1
              ? `<strong>${esc(name)}</strong><br/><span class="pill">National holiday today</span>`
              : `<strong>${esc(name)}</strong><br/><span class="pill">No holiday today</span>`;
          }

          return val == null
            ? `<strong>${esc(name)}</strong><br/><span class="pill">No data</span>`
            : `<strong>${esc(name)}</strong><br/><span class="pill">${val} national holidays</span>`;
        }
      },

      plotOptions: {
        series: {
          states: {
            hover: { animation: { duration: 0 }, halo: false },
            inactive: { opacity: 1 }
          },
          animation: false,
          nullInteraction: true,
          enableMouseTracking: true,
          cursor: 'pointer'
        }
      },

      series: [{
        type: 'map',
        mapData: topology,
        data: rows,                                  // [hc-key, value, label]
        keys: ['hc-key','value','label'],
        joinBy: ['hc-key','hc-key'],
        allAreas: true,

        // Borders & selection
        borderColor: '#cfd7e6',
        borderWidth: 0.20,
        allowPointSelect: true,
        states: {
          hover:  { color: '#ffe082', animation: { duration: 0 }, halo: false, borderWidth: 0.2, borderColor: '#000', brightness: 0.15 },
          select: { color: '#ffe082', borderColor: '#000', borderWidth: 0.2, brightness: 0.15 }
        },

        dataLabels: { enabled: false },
        inactiveOtherPoints: false,

        point: {
          events: {
            mouseOver: function () {
              const c = this.series.chart;
              c.tooltip.refresh(this);
              this.setState('hover');
            },
            mouseOut: function () {
              const c = this.series.chart;
              c.tooltip.hide(0);
              this.setState();
            },
            click: async function () {
              // Highlight + render table (no zoom)
              const hcKey = (this.options['hc-key'] || this['hc-key'] || '').toUpperCase();
              const iso2  = hcKey;
              const display = (TOTALS[iso2]?.name) || this.name || iso2;

              // Select only one
              this.series.points.forEach(p => { if (p !== this && p.selected) p.select(false, false); });
              this.select(true, false);

              try {
                const holidays = await getCountryDetails(iso2);
                await renderDetails(iso2, display, holidays, null, CURRENT_MODE);
                renderRegionList(iso2);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              } catch {
                await renderDetails(iso2, display, [], null, CURRENT_MODE);
                renderRegionList(iso2);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              }
            }
          }
        }
      }]
    });

    // ---- View tags (All Year / Today) ----
    const tagsEl = document.querySelector('.view-tags');
    if (tagsEl) {
      tagsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-tag');
        if (!btn) return;

        tagsEl.querySelectorAll('.view-tag').forEach(b => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        setView(btn.dataset.view); // 'all' or 'today'
      });
    }

    // Warm the Today cache in the background
    fetchTodaySet(YEAR).catch(() => {});

    // ---- Details view toggles (List / Calendar) ----
    const detailsTabs = document.querySelector('.details-views');
    if (detailsTabs) {
      detailsTabs.addEventListener('click', async (e) => {
        const btn = e.target.closest('.details-view');
        if (!btn || !CURRENT_DETAILS) return;

        const next = btn.id === 'details-view-cal' ? 'cal' : 'list';
        if (next === CURRENT_MODE) return;
        CURRENT_MODE = next;

        const { iso2, displayName, holidays, regionCode } = CURRENT_DETAILS;
        await renderDetails(iso2, displayName, holidays, regionCode, CURRENT_MODE);
      });
    }

    // ---- View switching (Map: All Year vs Today) ----
    const ALL_DATA = rows.slice();
    const ALL_COLOR_CLASSES = [
      { to: 4,              color: '#d9f2e3', name: '≤ 4' },
      { from: 5,  to: 7,    color: '#a9d9d8', name: '5-7' },
      { from: 8,  to: 10,   color: '#8cc7e4', name: '8-10' },
      { from: 11, to: 13,   color: '#6db3ea', name: '11-13' },
      { from: 14, to: 19,   color: '#4d9ae8', name: '14-19' },
      { from: 20,           color: '#0b3d91', name: '20+' }
    ];

    async function setView(view) {
      if (view === CURRENT_VIEW) return;
      CURRENT_VIEW = view;

      if (view === 'all') {
        chart.update({
          colorAxis: { dataClasses: ALL_COLOR_CLASSES, dataClassColor: 'category', nullColor: '#d9d9d9' }
        }, false);
        chart.series[0].setData(ALL_DATA, false);
        chart.redraw();
        return;
      }

      // --- TODAY (minimal + robust) ---
      setLoading(true, 'Loading Today…');

      // Normalize today list using util; compare in lowercase
      const todayList = await fetchTodaySet(YEAR);           // ISO2 UPPER (unique)
      const todaySet = new Set(todayList.map(c => c.toLowerCase()));

      // Build data straight from map geometry keys
      const mapData = chart.series[0].mapData || [];
      const todayData = mapData.map(p => {
        const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase(); // e.g., 'al'
        const iso2 = keyLc.toUpperCase(); // e.g., 'AL'
        const hasHoliday = todaySet.has(keyLc); // case-insensitive match
        return [keyLc, hasHoliday ? 1 : null, (TOTALS[iso2]?.name) || iso2];
      });

      chart.update({
        colorAxis: {
          dataClassColor: 'category',
          dataClasses: [
            { to: 0, color: '#d9d9d9', name: 'No holiday today' },
            { from: 1, color: '#0b3d91', name: 'Holiday today' }
          ],
          nullColor: '#d9d9d9'
        }
      }, false);

      chart.series[0].setData(todayData, false);
      chart.redraw();
      setLoading(false);
    }

  } catch (err) {
    console.error('Init failed:', err);
    const el = document.getElementById('wpr-map');
    if (el) el.innerHTML = '<div class="note" style="padding:16px">Failed to load map.</div>';
  }
})();

// ==== Next N Days (client-only) =============================================

// --- utils (UTC-safe dates)
const haPad = (n) => String(n).padStart(2, "0");
const haIsoUTC = (d) => `${d.getUTCFullYear()}-${haPad(d.getUTCMonth()+1)}-${haPad(d.getUTCDate())}`;
const haTodayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const haWeekdayUTC = (iso) => {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d)).toLocaleDateString(undefined, { weekday: "long" });
};

// --- pickers tolerant of different holiday shapes
function haPickDate(h, yearFallback) {
  if (!h) return null;
  if (typeof h.date === "string") return h.date;                 // "YYYY-MM-DD"
  if (h.isoDate) return h.isoDate;
  if (h.on) return h.on;
  if (h.d) return h.d;
  if (h.date && typeof h.date === "object" && typeof h.date.iso === "string") return h.date.iso;
  if (Number.isInteger(h.month) && Number.isInteger(h.day)) {
    const y = Number(h.year) || yearFallback || new Date().getFullYear();
    return `${y}-${haPad(h.month)}-${haPad(h.day)}`;
  }
  return null;
}
const haPickName = (h) => h?.name || h?.title || h?.localName || "Holiday";

// --- derive year from your existing title "Holidays (2025)"
function haCurrentYear() {
  const t = document.querySelector("#details-title")?.textContent || "";
  const m = t.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : new Date().getFullYear();
}

// --- load totals for the current year (prefer already-loaded window.TOTALS)
async function haLoadTotals(year) {
  if (window.TOTALS && typeof window.TOTALS === "object") {
    const totals = window.TOTALS;
    return Array.isArray(totals)
      ? totals
      : Object.entries(totals).map(([iso2, rec]) => ({ iso2, ...rec }));
  }
  const res = await fetch(`/data/totals-${year}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Missing /data/totals-${year}.json`);
  const data = await res.json();
  return Array.isArray(data)
    ? data
    : Object.entries(data).map(([iso2, rec]) => ({ iso2, ...rec }));
}

// --- compute window union + by-date (group by date, count)
function haComputeWindow(entries, startISO, days, year) {
  const start = new Date(startISO + "T00:00:00Z");
  const end   = new Date(start);
  end.setUTCDate(end.getUTCDate() + (days - 1));

  const inWindow = (iso) => {
    const [y,m,d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m-1, d));
    return dt >= start && dt <= end;
  };

  const iso2Set = new Set();
  const byDate = Object.create(null);

  for (const rec of entries) {
    const iso2    = rec.iso2 || rec.code || rec.countryCode || rec.id;
    const country = rec.country || rec.countryName || rec.name || iso2;
    const list    = rec.holidays || rec.days || rec.entries || rec.items || rec.list || [];
    for (const h of list) {
      const ds = haPickDate(h, year);
      if (!ds || !inWindow(ds)) continue;
      // If your dataset contains regional flags and you want national-only, keep this:
      // if (h.type === "Regional" || h.regional === true) continue;

      (byDate[ds] ||= []).push({ iso2, country, name: haPickName(h) });
      iso2Set.add(iso2);
    }
  }

  // sort by date ascending
  const sortedByDate = Object.fromEntries(Object.keys(byDate).sort().map(k => [k, byDate[k]]));
  return { iso2: Array.from(iso2Set).sort(), byDate: sortedByDate,
           start: startISO, end: haIsoUTC(end) };
}

// --- minimal details renderer (non-destructive; replace if you have your own)
function haRenderDetailsByDate(byDate, titleNote) {
  const elBody = document.querySelector("#details-body");
  if (!elBody) return;
  elBody.innerHTML = ""; // clear

  const wrap = document.createElement("div");
  for (const [date, items] of Object.entries(byDate)) {
    const sec = document.createElement("section");
    sec.className = "details-section";
    const h = document.createElement("h4");
    h.textContent = `${date} (${haWeekdayUTC(date)}) — ${items.length} holiday${items.length>1?"s":""}`;
    sec.appendChild(h);

    const ul = document.createElement("ul");
    items.forEach(x => {
      const li = document.createElement("li");
      li.textContent = `${x.country || x.iso2}: ${x.name}`;
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    wrap.appendChild(sec);
  }
  elBody.appendChild(wrap);

  const elTitle = document.querySelector("#details-title");
  if (elTitle && titleNote) elTitle.textContent = `Holidays (${haCurrentYear()}) — ${titleNote}`;
}

// --- paint map using your existing function if available
function haPaintMap(iso2List) {
  // If your app exposes a painter, call it:
  if (typeof window.haColorCountries === "function") {
    window.haColorCountries(iso2List);
    return;
  }
  // Else, if you have a function you use for "Today", call that here instead.
  // (Leaving empty won’t break anything; you’ll still get the details list.)
}

// --- loading chip helpers (optional, matches your #view-loading)
function haSetLoading(msg) {
  const chip = document.querySelector("#view-loading");
  if (!chip) return;
  if (msg) { chip.textContent = msg; chip.hidden = false; }
  else { chip.hidden = true; }
}

// --- main “next N days” entry
async function haShowNext(days) {
  try {
    const YEAR = haCurrentYear();
    haSetLoading(`Loading next ${days} days…`);
    const startISO = haIsoUTC(haTodayUTC());
    const totals = await haLoadTotals(YEAR);
    const { iso2, byDate, start, end } = haComputeWindow(totals, startISO, days, YEAR);

    haPaintMap(iso2);                           // color countries (if you expose a painter)
    haRenderDetailsByDate(byDate, `Next ${days} days (${start} → ${end})`);
  } catch (e) {
    console.error(e);
    haRenderDetailsByDate({}, `Next ${days} days — error`);
  } finally {
    haSetLoading(null);
  }
}

// --- wire the two buttons without touching your existing Today handler
function haSetActiveView(viewName, btnEl) {
  document.querySelectorAll(".view-tag").forEach(b => b.classList.remove("is-active"));
  if (btnEl) btnEl.classList.add("is-active");
}

document.querySelector('[data-view="next7"]')?.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  haSetActiveView("next7", e.currentTarget);
  haShowNext(7);
});
document.querySelector('[data-view="next30"]')?.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();
  haSetActiveView("next30", e.currentTarget);
  haShowNext(30);
});

