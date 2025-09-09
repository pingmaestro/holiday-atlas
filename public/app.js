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

  // Persistent selection (All Year only)
  let SELECTED_KEY = null;             // ISO2 UPPER (e.g., 'CA')

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
  const TODAY_MODE = 'global'; // or 'local'

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
        params.set('mode', 'local');
      }

      const res = await fetch(`/api/todaySet?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);

      const raw = res.ok ? await res.json() : { today: [] };
      const arr = Array.isArray(raw.today) ? raw.today : [];

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
  async function getLongWeekends(iso2, year) {
    const key = `${iso2}-${year}`;
    if (longWeekendCache.has(key)) return longWeekendCache.get(key);

    try {
      const url = `https://date.nager.at/api/v3/LongWeekend/${year}/${iso2}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json();
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

  // ---- Calendar renderer ----
  function renderCalendarHTML(year, holidays, longWeekendDates) {
    const holidayMap = new Map();
    holidays.forEach(h => {
      const d = h.date;
      if (!holidayMap.has(d)) holidayMap.set(d, []);
      holidayMap.get(d).push(h.name || h.localName || 'Holiday');
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthNames = Array.from({ length: 12 }, (_, i) =>
      new Date(year, i, 1).toLocaleString(undefined, { month: 'long' })
    );
    const dow = ['S','M','T','W','T','F','S'];

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

  // ---- Lightweight calendar tooltip ----
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

    const all = Array.isArray(holidays) ? holidays : [];
    const natList = all.filter(h => h && h.global === true);

    const { dateSet: lwDates } = await getLongWeekends(iso2, YEAR);

    const suffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${suffix} — Holidays (${YEAR})`;

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
          contextButton: { align: 'right', verticalAlign: 'top', x: -8, y: 8, theme: { r: 8 } }
        }
      },

      // Zoom buttons stacked under the burger
      mapNavigation: {
        enabled: true,
        enableButtons: true,
        enableMouseWheelZoom: true,
        enableDoubleClickZoomTo: false,
        enableDoubleClickZoom: false,
        enableTouchZoom: false,
        buttonOptions: {
          align: 'right',
          verticalAlign: 'top',
          x: -8,
          y: 56,
          theme: {
            fill: '#fff',
            stroke: '#cfd7e6',
            'stroke-width': 1,
            r: 8,
            states: {
              hover: { fill: '#e8f3ff' },
              select: { fill: '#cde3ff' }
            }
          }
        },
        buttons: {
          zoomIn:  {},
          zoomOut: { y: 44 }
        }
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

        // Base borders kept thin; selection will be drawn by overlay (same width)
        borderColor: '#000',
        borderWidth: 0.15,
        allowPointSelect: false, // we don't use native select color; overlay handles it

        states: {
          hover:  { color: '#ffe082', animation: { duration: 0 }, halo: false, borderWidth: 0.15, borderColor: '#000', brightness: 0.10 },
          select: { color: undefined, borderWidth: 0.15, borderColor: '#000', brightness: 0 } // keep width same if ever used
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
              this.setState(); // hover off
            },
            click: async function () {
              const hcKey = (this.options['hc-key'] || this['hc-key'] || '').toUpperCase();
              const iso2  = hcKey;
              const display = (TOTALS[iso2]?.name) || this.name || iso2;

              if (CURRENT_VIEW === 'all') {
                // Set persistent selection (All Year only)
                setSelection(hcKey);
              }

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

    // === Thin, non-interactive world borders (crisp outlines) ===
    const borderLines = Highcharts.geojson(topology, 'mapline');
    chart.addSeries({
      type: 'mapline',
      data: borderLines,
      color: '#cfd7e6',            // tweak if you want darker/lighter
      lineWidth: 0.6,
      enableMouseTracking: false,
      showInLegend: false,
      zIndex: 6
    }, false);

    // === Selection overlay series (paints clicked country on top; no thicker border) ===
    const selectionSeries = chart.addSeries({
      type: 'map',
      name: 'SelectionOverlay',
      mapData: chart.series[0].mapData,
      joinBy: ['hc-key','hc-key'],
      data: [],
      colorAxis: false,
      color: '#ffc54d',            // yellow fill
      borderColor: '#000',
      borderWidth: 0.15,           // SAME as base so width doesn't change
      enableMouseTracking: false,  // visuals only
      showInLegend: false,
      zIndex: 7,
      states: { hover: { enabled: false }, select: { enabled: false } }
    }, false);

    // Make absolutely sure overlay never steals clicks
    if (selectionSeries.group && selectionSeries.group.css) {
      selectionSeries.group.css({ 'pointer-events': 'none' });
    }

    chart.redraw();

    // --- Selection helpers ---
    function setSelection(hcKeyUpper) {
      SELECTED_KEY = hcKeyUpper;
      selectionSeries.setData([[hcKeyUpper.toLowerCase(), 1]], false);
      chart.redraw();
    }
    function clearSelection() {
      SELECTED_KEY = null;
      selectionSeries.setData([], false);
      chart.redraw();
    }
    function reselectIfNeeded() {
      if (CURRENT_VIEW !== 'all' || !SELECTED_KEY) return; // only persist in All Year
      selectionSeries.setData([[SELECTED_KEY.toLowerCase(), 1]], false);
      chart.redraw();
    }

    // Expose a painter so Next 7/30 can color the map like "Today"
    window.haColorCountries = function (iso2UpperList) {
      // Clear any All-Year selection when painting Next-N
      clearSelection();

      const lcSet = new Set(iso2UpperList.map(c => String(c).toLowerCase()));
      const mapData = chart.series[0].mapData || [];
      const data = mapData.map(p => {
        const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
        const iso2 = keyLc.toUpperCase();
        const has = lcSet.has(keyLc);
        return [keyLc, has ? 1 : null, (TOTALS[iso2]?.name) || iso2];
      });

      chart.update({
        colorAxis: {
          dataClassColor: 'category',
          dataClasses: [
            { to: 0, color: '#d9d9d9', name: 'No holiday in window' },
            { from: 1, color: '#0b3d91', name: 'Has ≥1 holiday' }
          ],
          nullColor: '#d9d9d9'
        }
      }, false);

      chart.series[0].setData(data, false);
      chart.redraw();
      CURRENT_VIEW = 'today';
    };

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
        // Restore original classes and data, keep any All-Year selection visible
        chart.update({
          colorAxis: { dataClasses: ALL_COLOR_CLASSES, dataClassColor: 'category', nullColor: '#d9d9d9' }
        }, false);
        chart.series[0].setData(ALL_DATA, false);
        chart.redraw();
        reselectIfNeeded();
        return;
      }

      // --- TODAY (and relatives) ---
      // Clear selection when leaving All Year
      clearSelection();

      setLoading(true, 'Loading Today…');

      const todayList = await fetchTodaySet(YEAR); // ISO2 UPPER (unique)
      const todaySet = new Set(todayList.map(c => c.toLowerCase()));

      const mapData = chart.series[0].mapData || [];
      const todayData = mapData.map(p => {
        const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
        const iso2 = keyLc.toUpperCase();
        const hasHoliday = todaySet.has(keyLc);
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

/* ===== Next N days powered by todaySet (no hardcoded JSON) =============== */
(() => {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const weekdayUTC = (iso) => {
    const [y,m,d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m-1, d)).toLocaleDateString(undefined, { weekday: 'long' });
  };

  function todayISO() {
    const n = new Date();
    return isoUTC(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
  }

  function setLoading(msg) {
    const chip = $('#view-loading');
    if (!chip) return;
    if (msg) { chip.textContent = msg; chip.hidden = false; document.body.setAttribute('aria-busy', 'true'); }
    else { chip.hidden = true; document.body.removeAttribute('aria-busy'); }
  }

  function renderDetailsByDate(byDate, titleNote) {
    const body = $('#details-body');
    if (!body) return;
    body.innerHTML = '';
    const wrap = document.createElement('div');
    for (const [date, items] of Object.entries(byDate)) {
      const sec = document.createElement('section');
      sec.className = 'details-section';
      const h = document.createElement('h4');
      h.textContent = `${date} (${weekdayUTC(date)}) — ${items.length} holiday${items.length>1?'s':''}`;
      sec.appendChild(h);
      const ul = document.createElement('ul');
      items.forEach(x => {
        const li = document.createElement('li');
        li.textContent = `${x.iso2}: ${x.name}`;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      wrap.appendChild(sec);
    }
    body.appendChild(wrap);

    const title = $('#details-title');
    if (title && titleNote) title.textContent = `Holidays (${new Date().getFullYear()}) — ${titleNote}`;
  }

  async function fetchDay(dateISO) {
    const r = await fetch(`/api/todaySet?date=${dateISO}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `todaySet failed for ${dateISO}`);
    // j.today = ["AL","FR",...], j.items = [{iso2,name}] for that date
    return j;
  }

  async function showNext(days) {
    setLoading(`Loading next ${days} days…`);
    try {
      const start = todayISO();
      const [y,m,d] = start.split('-').map(Number);
      const startDt = new Date(Date.UTC(y, m-1, d));
      const dates = Array.from({ length: days }, (_, i) => {
        const dt = new Date(startDt); dt.setUTCDate(dt.getUTCDate() + i);
        return isoUTC(dt);
      });

      const results = await Promise.all(dates.map(fetchDay));

      const iso2Set = new Set();
      const byDate = {};
      results.forEach(r => {
        (r.today || []).forEach(c => iso2Set.add(c));
        if (r.items?.length) (byDate[r.date] ||= []).push(...r.items);
      });

      const sortedByDate = Object.fromEntries(Object.keys(byDate).sort().map(k => [k, byDate[k]]));

      // Paint and (intentionally) clear any All-Year selection
      if (typeof window.haColorCountries === 'function') {
        window.haColorCountries(Array.from(iso2Set).sort());
      }
      const end = dates[dates.length - 1];
      renderDetailsByDate(sortedByDate, `Next ${days} days (${start} → ${end})`);
    } catch (e) {
      console.error('[nextN] error', e);
      renderDetailsByDate({}, `Next ${days} days — error`);
    } finally {
      setLoading(null);
    }
  }

  // Wire buttons; stop parent tab handler from hijacking the click
  function setActive(btn) {
    document.querySelectorAll('.view-tag').forEach(b => b.classList.remove('is-active'));
    btn?.classList.add('is-active');
  }

  const btn7 = document.querySelector('[data-view="next7"]');
  if (btn7) {
    btn7.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setActive(e.currentTarget);
      showNext(7);
    }, { capture: true });
  }

  const btn30 = document.querySelector('[data-view="next30"]');
  if (btn30) {
    btn30.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setActive(e.currentTarget);
      showNext(30);
    }, { capture: true });
  }
})();
