// Highcharts Maps (no D3) — full-bleed, square buttons, rounded legend labels
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
      <div class="row region-row" data-code="${code}" style="cursor:pointer">
        <div class="cell">${code}</div>
        <div class="cell"><span class="pill">${count} regional</span></div>
      </div>
    `).join('');

    rows.querySelectorAll('.region-row').forEach(el => {
      const code = el.getAttribute('data-code');
      el.title = `${code}: ${m[code]} regional holidays`;
      el.addEventListener('click', async () => {
        const cacheKey = `${iso2}-${YEAR}`;
        const holidays = detailsCache.get(cacheKey) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        renderDetails(iso2, countryName, holidays, code);
        detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Rounded integer data classes for legend (no ugly decimals)
  function makeIntegerClasses(values, steps = 6) {
    if (!values.length) return [{ to: 1, color: '#d9d9d9', name: 'No data' }];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return [{ from: min, color: '#3c7fd6', name: String(min) }];
    }
    const range = max - min;
    const rawStep = range / steps;
    const step = Math.max(1, Math.round(rawStep)); // round to whole numbers

    const colors = ['#e8f5e9','#ccebd6','#b3dfdf','#95cce6','#6fb4e5','#3c7fd6'];
    const classes = [];
    let lo = min, idx = 0;

    while (lo <= max && idx < colors.length) {
      let hi = Math.min(max, lo + step - 1);
      // Label style: "≤ X", "A–B", "≥ Y"
      let name;
      if (idx === 0)       name = `≤ ${hi}`;
      else if (hi === max) name = `≥ ${lo}`;
      else                 name = `${lo}–${hi}`;

      classes.push({ from: idx === 0 ? undefined : lo, to: hi, color: colors[idx], name });
      lo = hi + 1; idx++;
    }
    return classes;
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

  try {
    // 1) Load totals JSON (cache-busted)
    const totalsRes = await fetch(`/data/totals-2025.json?v=${Date.now()}`, { cache: 'no-store' });
    const totalsJSON = await totalsRes.json();
    TOTALS = totalsJSON.totals || {};
    REGIONS = totalsJSON.regions || {};

    // 2) Prepare series data for Highcharts
    const rows = Object.entries(TOTALS).map(([code, rec]) => [
      code,
      Number.isFinite(rec?.national) ? rec.national : null,
      Number.isFinite(rec?.regional) ? rec.regional : null,
      rec?.name || code
    ]);
    const nationalValues = rows.map(r => r[1]).filter(v => v !== null);

    // 3) Load Highcharts world topology
    const topology = await fetch('https://code.highcharts.com/mapdata/custom/world.topo.json').then(r => r.json());

    // 4) Render map (full-bleed, square buttons, zoom stacked under burger)
    Highcharts.mapChart('wpr-map', {
      chart: {
        map: topology,
        spacing: [0, 0, 0, 0],
        backgroundColor: 'transparent'
      },
      title: { text: null }, // <— remove title bar entirely
      legend: {
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { fontSize: '12px' }
      },
      credits: { enabled: true }, // keep as-is for licensing
      exporting: {
        enabled: true,
        buttons: {
          contextButton: {
            align: 'right',
            verticalAlign: 'top',
            x: -8, y: 8,
            theme: { r: 0 } // square burger
          }
        }
      },
      mapNavigation: {
        enabled: true,
        enableMouseWheelZoom: false,
        buttonOptions: {
          align: 'right',
          verticalAlign: 'top',
          x: -8,
          theme: {
            r: 0, // square buttons
            'stroke-width': 1,
            stroke: '#cfd7e6',
            fill: '#ffffff'
          }
        },
        // stack zoom buttons under the burger
        buttons: {
          zoomIn:  { y: 48 },
          zoomOut: { y: 84 }
        }
      },
      colorAxis: {
        dataClasses: makeIntegerClasses(nationalValues),
        nullColor: '#d9d9d9',
        labels: { formatter: function() { return this.value ? Math.round(this.value) : this.value; } }
      },
      tooltip: {
        useHTML: true,
        headerFormat: '',
        formatter: function () {
          const code = this.point.options.code;
          const nat  = this.point.options.value ?? '—';
          const reg  = this.point.options.regional ?? (TOTALS[code]?.regional ?? '—');
          const name = this.point.name || this.point.options.label || code;
          return `<strong>${Highcharts.escapeHTML(name)}</strong><br/>
                  <span class="pill">${nat} national</span>
                  <span class="pill" style="margin-left:6px">${reg} regional</span>`;
        }
      },
      series: [{
        name: '# of National Holidays (2025)',
        data: rows,                              // [code, national, regional, label]
        keys: ['code', 'value', 'regional', 'label'],
        joinBy: ['iso-a2', 'code'],             // iso-a2 is built into the TopoJSON
        borderColor: '#cfd7e6',
        nullColor: '#d9d9d9',
        states: { hover: { color: '#ffe082' } },
        dataLabels: { enabled: false },
        point: {
          events: {
            click: async function () {
              const code = this.options.code;
              const display = TOTALS[code]?.name || this.name || code;
              if (typeof this.zoomTo === 'function') this.zoomTo(); // zoom into country
              const holidays = await getCountryDetails(code);
              renderDetails(code, display, holidays, null);
              renderRegionList(code);
              detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }
      }]
    });
  } catch (err) {
    console.error('Init failed:', err);
    const el = document.getElementById('wpr-map');
    if (el) el.innerHTML = '<div class="note" style="padding:16px">Failed to load map.</div>';
  }
})();
