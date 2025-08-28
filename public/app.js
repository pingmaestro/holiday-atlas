console.log("Holiday Atlas app.js build v10");

// Holiday Atlas app.js build v10
// Highcharts Maps — snappy hover, include null areas, clean tooltip (no HC.escapeHTML)

(async function () {
  const YEAR = 2025;

  // --- small safe HTML escaper (fix for missing Highcharts.escapeHTML) ---
  const esc = s => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  let TOTALS = {};
  let REGIONS = {};
  const detailsCache = new Map();

  const detailsEl = document.getElementById('details');
  const detailsTitle = document.getElementById('details-title');
  const detailsBody = document.getElementById('details-body');

  function renderDetails(iso2, displayName, holidays, regionCode = null) {
    detailsEl.style.display = 'block';
    const suffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${suffix} — Holidays (${YEAR})`;

    let list = Array.isArray(holidays) ? holidays : [];
    if (regionCode) list = list.filter(h => Array.isArray(h.counties) && h.counties.includes(regionCode));

    if (!list.length) {
      detailsBody.innerHTML = `<div class="note">No data available.</div>`;
      return;
    }

    const rows = list.map(h => {
      const pretty = new Date(h.date).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
      const nm = h.localName && h.localName !== h.name ? `${esc(h.name)} <span class="note">(${esc(h.localName)})</span>` : esc(h.name);
      const scope = h.global ? 'national' : 'regional';
      return `<div class="row">
        <div class="cell">${pretty}</div>
        <div class="cell">${nm}</div>
        <div class="cell"><span class="pill">${scope}</span></div>
      </div>`;
    }).join('');

    detailsBody.innerHTML = rows;
  }

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
        <div class="cell">${esc(code)}</div>
        <div class="cell"><span class="pill">${count} regional</span></div>
      </div>
    `).join('');

    rows.querySelectorAll('.region-row').forEach(el => {
      const code = el.getAttribute('data-code');
      el.title = `${code}: ${m[code]} regional holidays`;
      el.addEventListener('click', () => {
        const holidays = detailsCache.get(`${iso2}-${YEAR}`) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        renderDetails(iso2, countryName, holidays, code);
        detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function makeIntegerClasses(values, steps = 6) {
    if (!values.length) return [{ to: 1, color: '#d9d9d9', name: 'No data' }];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ from: min, color: '#3c7fd6', name: String(min) }];
    const range = max - min;
    const step = Math.max(1, Math.round(range / steps));
    const colors = ['#e8f5e9','#ccebd6','#b3dfdf','#95cce6','#6fb4e5','#3c7fd6'];

    const classes = [];
    let lo = min, idx = 0;
    while (lo <= max && idx < colors.length) {
      const hi = Math.min(max, lo + step - 1);
      const name = idx === 0 ? `≤ ${hi}` : (hi === max ? `≥ ${lo}` : `${lo}–${hi}`);
      classes.push({ from: idx === 0 ? undefined : lo, to: hi, color: colors[idx], name });
      lo = hi + 1; idx++;
    }
    return classes;
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

  try {
    // Load totals JSON (cache-busted)
    const totalsRes = await fetch(`/data/totals-2025.json?v=${Date.now()}`, { cache: 'no-store' });
    const totalsJSON = await totalsRes.json();
    TOTALS = totalsJSON.totals || {};
    REGIONS = totalsJSON.regions || {};

    // Build data rows: [code, national, label]
    const rows = Object.entries(TOTALS).map(([code, rec]) => [
      code,
      Number.isFinite(rec?.national) ? rec.national : null,
      rec?.name || code
    ]);
    const nationalValues = rows.map(r => r[1]).filter(v => v !== null);

    // Load world topology
    const topology = await fetch('https://code.highcharts.com/mapdata/custom/world.topo.json').then(r => r.json());

    Highcharts.mapChart('wpr-map', {
      chart: {
        map: topology,
        spacing: [0, 0, 0, 0],
        backgroundColor: 'transparent',
        animation: false
      },
      title: { text: null },
      credits: { enabled: true },
      // Either add the accessibility module script, or disable the warning:
      accessibility: { enabled: false },

      exporting: {
        enabled: true,
        buttons: {
          contextButton: { align: 'right', verticalAlign: 'top', x: -8, y: 8, theme: { r: 0 } }
        }
      },
      mapNavigation: {
        enabled: true,
        enableMouseWheelZoom: false,
        buttonOptions: {
          align: 'right',
          verticalAlign: 'top',
          x: -8,
          theme: { r: 0, 'stroke-width': 1, stroke: '#cfd7e6', fill: '#ffffff' }
        },
        buttons: { zoomIn: { y: 48 }, zoomOut: { y: 84 } }
      },
      legend: {
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { fontSize: '12px' }
      },
      colorAxis: {
        dataClasses: makeIntegerClasses(nationalValues),
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
          const name = this.point.name || this.point.options?.label || this.point.options?.code || '';
          const val = (typeof this.point.value === 'number') ? this.point.value : null;
          if (val === null) {
            return `<strong>${esc(name)}</strong><br/><span class="pill">No data</span>`;
          }
          return `<strong>${esc(name)}</strong><br/><span class="pill">${val} national holidays</span>`;
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
        name: '# of National Holidays (2025)',
        data: rows,                          // [code, national, label]
        keys: ['code', 'value', 'label'],
        joinBy: ['iso-a2', 'code'],
        allAreas: true,                      // render grey countries too
        borderColor: '#cfd7e6',
        nullColor: '#d9d9d9',
        states: { hover: { color: '#ffe082', animation: { duration: 0 }, halo: false } },
        dataLabels: { enabled: false },
        point: {
          events: {
            mouseOver: function () {
              // force tooltip to show immediately (also for null points)
              const chart = this.series.chart;
              chart.tooltip.refresh(this);
              this.setState('hover');
            },
            mouseOut: function () {
              const chart = this.series.chart;
              chart.tooltip.hide(0);
              this.setState();
            },
            click: async function () {
              const code = this.options.code;
              const display = TOTALS[code]?.name || this.name || code;
              if (typeof this.zoomTo === 'function') this.zoomTo();
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
