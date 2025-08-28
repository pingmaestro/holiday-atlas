// Highcharts Maps version (no D3)
(async function () {
  const YEAR = 2025;

  // State
  let TOTALS = {};   // { FR:{ name, national, regional }, ... }
  let REGIONS = {};  // { FR:{ 'FR-75': n, ... }, ... }
  const detailsCache = new Map(); // key: "FR-2025" -> holidays[]

  // Elements
  const detailsEl = document.getElementById('details');
  const detailsTitle = document.getElementById('details-title');
  const detailsBody = document.getElementById('details-body');

  // Render details panel (optional region filter)
  function renderDetails(iso2, displayName, holidays, regionCode = null) {
    detailsEl.style.display = 'block';
    const suffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${suffix} — Holidays (${YEAR})`;

    let list = holidays || [];
    if (regionCode) {
      list = list.filter(h => Array.isArray(h.counties) && h.counties.includes(regionCode));
    }

    if (!list.length) {
      detailsBody.innerHTML = `<div class="note">No data available.</div>`;
      return;
    }

    const rows = list.map(h => {
      const pretty = new Date(h.date).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
      const nm = h.localName && h.localName !== h.name ? `${h.name} <span class="note">(${h.localName})</span>` : h.name;
      const scope = h.global ? 'national' : 'regional';
      return `<div class="row">
        <div class="cell">${pretty}</div>
        <div class="cell">${nm}</div>
        <div class="cell"><span class="pill">${scope}</span></div>
      </div>`;
    }).join('');

    detailsBody.innerHTML = rows;
  }

  // Render region list below the map
  function renderRegionList(iso2) {
    const anchor = document.getElementById('region-list-anchor');
    let card = document.getElementById('region-list');
    if (!card) {
      card = document.createElement('article');
      card.id = 'region-list';
      card.className = 'card';
      card.style.marginTop = '16px';
      card.innerHTML = `<div class="hd"><strong>States / Provinces</strong></div><div class="bd"><div id="region-rows" class="rows"></div></div>`;
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
      <div class="row region-row" data-code="${code}" style="cursor:pointer">
        <div class="cell">${code}</div>
        <div class="cell"><span class="pill">${count} regional</span></div>
      </div>
    `).join('');

    rows.querySelectorAll('.region-row').forEach(el => {
      const code = el.getAttribute('data-code');
      el.title = `${code}: ${m[code]} regional holidays`;
      el.addEventListener('click', () => {
        const cacheKey = `${iso2}-${YEAR}`;
        const holidays = detailsCache.get(cacheKey) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        renderDetails(iso2, countryName, holidays, code);
        detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Build color classes (light green -> dark blue)
  function makeDataClasses(values) {
    if (!values.length) {
      return [{ to: 1, color: '#d9d9d9' }];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const a = (n) => min + (max - min) * n;
    return [
      { to: a(1/6),              color: '#e8f5e9' },
      { from: a(1/6), to: a(2/6), color: '#ccebd6' },
      { from: a(2/6), to: a(3/6), color: '#b3dfdf' },
      { from: a(3/6), to: a(4/6), color: '#95cce6' },
      { from: a(4/6), to: a(5/6), color: '#6fb4e5' },
      { from: a(5/6),            color: '#3c7fd6' }
    ];
  }

  // Fetch details from our serverless (cached)
  async function getCountryDetails(iso2) {
    const cacheKey = `${iso2}-${YEAR}`;
    if (detailsCache.has(cacheKey)) return detailsCache.get(cacheKey);
    try {
      const r = await fetch(`/api/holidayDetails?iso2=${iso2}&year=${YEAR}`);
      if (!r.ok) throw new Error(`details ${r.status}`);
      const data = await r.json();
      const list = Array.isArray(data.holidays) ? data.holidays : [];
      detailsCache.set(cacheKey, list);
      return list;
    } catch {
      detailsCache.set(cacheKey, []);
      return [];
    }
  }

  // Boot
  try {
    // 1) Load totals JSON (cache-busted)
    const totalsRes = await fetch(`/data/totals-2025.json?v=${Date.now()}`, { cache: 'no-store' });
    const totalsJSON = await totalsRes.json();
    TOTALS = totalsJSON.totals || {};
    REGIONS = totalsJSON.regions || {};

    // 2) Prepare series data for Highcharts
    // Build rows like: [code, national, regional, label]
    const rows = Object.entries(TOTALS).map(([code, rec]) => [
      code,
      Number.isFinite(rec?.national) ? rec.national : null,
      Number.isFinite(rec?.regional) ? rec.regional : null,
      rec?.name || code
    ]);

    const nationalValues = rows.map(r => r[1]).filter(v => v !== null);

    // 3) Load Highcharts world topology
    const topology = await fetch('https://code.highcharts.com/mapdata/custom/world.topo.json').then(r => r.json());

    // 4) Render map
    Highcharts.mapChart('wpr-map', {
      chart: { map: topology, spacing: [8, 8, 8, 8] },
      title: { text: 'Public Holidays — National Count (2025)' },
      legend: { layout: 'horizontal', align: 'center', verticalAlign: 'bottom' },
      credits: { enabled: true }, // leave on per Highcharts map licensing guidelines
      mapNavigation: {
        enabled: true,
        enableMouseWheelZoom: false,
        buttonOptions: { verticalAlign: 'top' }
      },
      colorAxis: {
        dataClasses: makeDataClasses(nationalValues),
        nullColor: '#d9d9d9'
      },
      tooltip: {
        useHTML: true,
        headerFormat: '',
        formatter: function () {
          // this.point.options => [code, national, regional, name] via keys below
          const code = this.point.options.code;
          const name = this.point.name || this.point.options.label || code;
          const nat  = this.point.options.value ?? '—';
          const reg  = this.point.options.regional ?? (TOTALS[code]?.regional ?? '—');
          return `<strong>${Highcharts.escapeHTML(name)}</strong><br/>
                  <span class="pill">${nat} national</span>
                  <span class="pill" style="margin-left:6px">${reg} regional</span>`;
        }
      },
      series: [{
        name: '# of National Holidays (2025)',
        // rows: [code, national, regional, label]
        data: rows,
        keys: ['code', 'value', 'regional', 'label'],
        joinBy: ['iso-a2', 'code'],
        borderColor: '#cfd7e6',
        nullColor: '#d9d9d9',
        states: { hover: { color: '#ffe082' } },
        dataLabels: { enabled: false },
        point: {
          events: {
            click: async function () {
              const code = this.options.code;
              const display = TOTALS[code]?.name || this.name || code;

              // Zoom to the clicked country
              if (typeof this.zoomTo === 'function') this.zoomTo();

              // Fetch & render details
              const holidays = await getCountryDetails(code);
              renderDetails(code, display, holidays, null);

              // Render region list (from prebuilt REGIONS)
              renderRegionList(code);

              // Focus details
              detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }
      }]
    });
  } catch (err) {
    console.error('Init failed:', err);
    const el = document.getElementById('wpr-map');
    if (el) el.innerHTML = '<div class="note">Failed to load map.</div>';
  }
})();
