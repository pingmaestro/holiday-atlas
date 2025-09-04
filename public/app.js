// Holiday Atlas app.js — dynamic year, All Year + Today views, List/Calendar detail modes

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

  // ---- State ----
  let TOTALS = {};   // { FR:{ name, national, regional }, ... }
  let REGIONS = {};  // { FR:{ 'FR-75': n, ... }, ... }
  const detailsCache = new Map(); // "FR-2025" -> holidays[]
  let CURRENT_VIEW = 'all';       // 'all' (year totals) or 'today'
  let CURRENT_MODE = 'list';      // 'list' or 'cal' for the details pane
  let CURRENT_DETAILS = null;     // { iso2, displayName, holidays, regionCode }

  // ---- Elements ----
  const detailsTitle = document.getElementById('details-title');
  const detailsBody  = document.getElementById('details-body');
  const loadingEl    = document.getElementById('view-loading');

  // ---- Loader + cache helpers (Today view) ----
  let TODAY_CACHE = { at: 0, list: [] };
  const TODAY_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

  async function fetchTodaySet(year) {
    const now = Date.now();
    if (now - TODAY_CACHE.at < TODAY_TTL_MS && TODAY_CACHE.list.length) {
      return TODAY_CACHE.list;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s cap
    try {
      const res = await fetch(`/api/todaySet?year=${year}`, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      const { today = [] } = res.ok ? await res.json() : { today: [] };
      TODAY_CACHE = { at: now, list: today };
      return today;
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

  // ---- Calendar renderer (12-month year grid) ----
  function renderCalendarHTML(year, holidays) {
    // Map yyyy-mm-dd -> holiday name(s)
    const map = new Map();
    holidays.forEach(h => {
      const d = h.date; // ISO yyyy-mm-dd
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(h.name || h.localName || 'Holiday');
    });

    const monthNames = Array.from({ length: 12 }, (_, i) =>
      new Date(year, i, 1).toLocaleString(undefined, { month: 'long' })
    );
    const dow = ['S','M','T','W','T','F','S']; // Sunday-start; adjust if you want Monday-start

    const months = monthNames.map((mn, mIdx) => {
      const first = new Date(year, mIdx, 1);
      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
      const startDOW = first.getDay(); // 0..6

      // leading blanks
      const blanks = Array.from({ length: startDOW }, () => `<div class="cal-day"></div>`);

      // actual days
      const days = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const yyyy = year;
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        const isHoliday = map.has(key);
        const title = isHoliday ? map.get(key).join(', ') : '';
        return `<div class="cal-day${isHoliday ? ' holiday' : ''}" title="${esc(title)}">${day}</div>`;
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

  // ---- Details renderer (List/Calendar) ----
  function renderDetails(iso2, displayName, holidays, regionCode = null, mode = CURRENT_MODE) {
    CURRENT_DETAILS = { iso2, displayName, holidays, regionCode };
    const suffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${suffix} — Holidays (${YEAR})`;

    // Activate correct tab buttons
    const btnList = document.getElementById('details-view-list');
    const btnCal  = document.getElementById('details-view-cal');
    if (btnList && btnCal) {
      btnList.classList.toggle('is-active', mode === 'list');
      btnList.setAttribute('aria-selected', mode === 'list' ? 'true' : 'false');
      btnCal.classList.toggle('is-active', mode === 'cal');
      btnCal.setAttribute('aria-selected', mode === 'cal' ? 'true' : 'false');
    }

    // Filter for region if present
    let list = Array.isArray(holidays) ? holidays : [];
    if (regionCode) list = list.filter(h => Array.isArray(h.counties) && h.counties.includes(regionCode));

    if (!list.length) {
      detailsBody.innerHTML = `<div class="note">No data available.</div>`;
      return;
    }

    if (mode === 'cal') {
      detailsBody.innerHTML = renderCalendarHTML(YEAR, list);
      return;
    }

    // List mode
    const rows = list.map(h => {
      const pretty = new Date(h.date).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
      const nm = h.localName && h.localName !== h.name
        ? `${esc(h.name)} <span class="note">(${esc(h.localName)})</span>`
        : esc(h.name);
      const scope = h.global ? 'national' : 'regional';
      return `<div class="row">
        <div class="cell">${pretty}</div>
        <div class="cell">${nm}</div>
        <div class="cell"><span class="pill">${scope}</span></div>
      </div>`;
    }).join('');

    detailsBody.innerHTML = `<div class="rows">${rows}</div>`;
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
      el.addEventListener('click', (evt) => {
        evt.preventDefault();
        const holidays = detailsCache.get(`${iso2}-${YEAR}`) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        renderDetails(iso2, countryName, holidays, code, CURRENT_MODE); // keep current mode
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
                renderDetails(iso2, display, holidays, null, CURRENT_MODE);
                renderRegionList(iso2);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              } catch {
                renderDetails(iso2, display, [], null, CURRENT_MODE);
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

    // ---- Warm the Today cache in the background ----
    fetchTodaySet(YEAR).catch(() => {});

    // ---- Details view toggles (List / Calendar) ----
    const detailsTabs = document.querySelector('.details-views');
    if (detailsTabs) {
      detailsTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.details-view');
        if (!btn || !CURRENT_DETAILS) return;

        const next = btn.id === 'details-view-cal' ? 'cal' : 'list';
        if (next === CURRENT_MODE) return;
        CURRENT_MODE = next;

        const { iso2, displayName, holidays, regionCode } = CURRENT_DETAILS;
        renderDetails(iso2, displayName, holidays, regionCode, CURRENT_MODE);
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

      // TODAY: show loader, use cached fetch, then render
      setLoading(true);
      const today = await fetchTodaySet(YEAR);
      const todaySet = new Set(today);

      const iso2List = Object.keys(TOTALS);
      const todayData = iso2List.map(iso2 => [
        iso2.toLowerCase(),
        todaySet.has(iso2) ? 1 : null,
        TOTALS[iso2]?.name || iso2
      ]);

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
