// doy-chart.js — Day-of-Year line chart (global + per-continent)
// Consumes counts emitted by busy-calendar via the 'busy-counts' event.
// If the event arrives later (hydration is still running), this module
// shows a "Loading…" card and updates when data arrives.

(function () {
  'use strict';

  const QS = new URLSearchParams(location.search);
  const YEAR = (() => {
    const y = Number(QS.get('year'));
    return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : new Date().getFullYear();
  })();

  const ALL_CONTINENTS = ['Africa','Asia','Europe','North America','South America','Oceania'];

  // --- DOM boot ---
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const { wrap, chartSlot, multSlot, toggle } = ensureHost();
    if (!wrap) return;

    // If busy-calendar has already published, draw immediately
    if (window.__wcalCounts && window.__wcalCounts.year === YEAR) {
      drawFromPayload(window.__wcalCounts);
    } else {
      setLoading(true);
    }

    // Listen for updates from busy-calendar (initial + incremental)
    window.addEventListener('busy-counts', (e) => {
      const detail = e.detail || {};
      if (detail.year !== YEAR) return;
      drawFromPayload(detail);
    });

    // Toggle between Global and Per-Continent
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.doy-view');
      if (!btn) return;
      Array.from(toggle.querySelectorAll('.doy-view')).forEach(b => {
        const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const mode = btn.dataset.view; // 'global' | 'continents'
      chartSlot.hidden = (mode !== 'global');
      multSlot.hidden  = (mode !== 'continents');
    });
  }

  // --- Host scaffolding (card + toggles) ---
  function ensureHost() {
    const busyCard = document.querySelector('#busy .card');
    const parent = busyCard?.parentNode || document.querySelector('#busy') || document.body;

    // Main card
    let card = document.getElementById('doy-card');
    if (!card) {
      card = document.createElement('article');
      card.id = 'doy-card';
      card.className = 'card';
      card.innerHTML = `
        <div class="doy-head">
          <h2>Day-of-Year — Global Holidays (${YEAR})</h2>
          <div class="doy-toggle">
            <button type="button" class="doy-view on" data-view="global" aria-selected="true">Global</button>
            <button type="button" class="doy-view" data-view="continents" aria-selected="false">By Continent</button>
          </div>
        </div>
        <div id="doy-loading" class="note" style="margin:8px 0;">Loading…</div>
        <div id="doy-chart" style="height:360px;"></div>
        <div id="doy-multiples" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;"></div>
      `;
      // place after the world calendar card if present
      if (busyCard && busyCard.nextSibling) parent.insertBefore(card, busyCard.nextSibling);
      else parent.appendChild(card);
    }

    const toggle = card.querySelector('.doy-toggle');
    const chartSlot = card.querySelector('#doy-chart');
    const multSlot = card.querySelector('#doy-multiples');

    // Minimal button styling
    toggle.querySelectorAll('.doy-view').forEach(b=>{
      b.style.cssText = 'font:12px/1 system-ui; padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer;';
    });
    toggle.querySelector('.doy-view.on')?.style.setProperty('background', '#eef6ff');

    return { wrap: card, chartSlot, multSlot, toggle };
  }

  function setLoading(show) {
    const el = document.getElementById('doy-loading');
    if (el) el.hidden = !show;
  }

  // --- Data → series helpers ---
  function ymdParts(s) { const [y,m,d] = s.split('-').map(Number); return {y,m,d}; }

  function toUTCPoint(yyyyMmDd, n) {
    const { y, m, d } = ymdParts(yyyyMmDd);
    return [ Date.UTC(y, m-1, d), Number(n)||0 ];
  }

  function seriesFromCounts(countsByDate) {
    const entries = Object.entries(countsByDate || {}).sort((a,b)=>a[0]<b[0]? -1 : 1);
    const data = entries.map(([date, n]) => toUTCPoint(date, n));
    const smooth = rollingMean(data, 7);
    const yMax = Math.max(0, ...data.map(p=>p[1]));
    return { data, smooth, yMax };
  }

  function rollingMean(xy, w=7) {
    // xy: [[ts, y], ...] evenly spaced daily
    const n = xy.length, out = new Array(n);
    const half = Math.floor(w/2);
    let sum = 0, q = [];
    for (let i=0;i<n;i++){
      const y = xy[i][1];
      q.push(y); sum += y;
      if (q.length > w) sum -= q.shift();
      const denom = Math.min(w, i+1, n - Math.max(0, i - (w-1)));
      out[i] = [xy[i][0], sum / q.length];
    }
    return out;
  }

  function topKLabels(data, k=6, minGapDays=6) {
    // pick k peaks with at least minGapDays separation (avoid clustered labels)
    const pts = data.map((p,i)=>({i, x:p[0], y:p[1]})).sort((a,b)=>b.y-a.y);
    const picked = [];
    for (const p of pts) {
      if (picked.length >= k) break;
      if (picked.every(q => Math.abs(p.i - q.i) >= minGapDays)) picked.push(p);
    }
    return picked.sort((a,b)=>a.i-b.i);
  }

  // --- Rendering ---
  function drawFromPayload(detail) {
    const { counts, index, continentByIso2 } = detail;
    setLoading(false);
    renderGlobal(counts);

    // Per-continent series only if we have an index (date -> countries)
    if (Array.isArray(index) && continentByIso2 && Object.keys(continentByIso2).length) {
      renderMultiples(index, continentByIso2);
    } else {
      // hide multiples pane if we can’t compute it
      const multSlot = document.getElementById('doy-multiples');
      if (multSlot) multSlot.hidden = true;
      // keep buttons in a valid state
      const tog = document.querySelector('#doy-card .doy-toggle');
      if (tog) {
        tog.querySelector('[data-view="global"]').classList.add('on');
        tog.querySelector('[data-view="continents"]').classList.remove('on');
      }
    }
  }

  function renderGlobal(countsByDate) {
    const chartSlot = document.getElementById('doy-chart');
    if (!chartSlot) return;

    const { data, smooth, yMax } = seriesFromCounts(countsByDate);
    const labels = topKLabels(data, 6, 6);

    Highcharts.chart(chartSlot, {
      chart: { type: 'line', height: 360, zoomType: 'x' },
      title: { text: null },
      credits: { enabled: false },
      legend: { enabled: true },
      xAxis: {
        type: 'datetime',
        tickInterval: 30 * 24 * 3600 * 1000, // ~monthly
        labels: { formatter: function(){ return Highcharts.dateFormat('%b', this.value);} }
      },
      yAxis: {
        title: { text: 'Countries with a national holiday' },
        maxPadding: 0.08
      },
      tooltip: {
        shared: true,
        xDateFormat: '%a, %b %e',
        pointFormatter: function () {
          return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${this.color};margin-right:6px"></span>` +
                 `${Highcharts.numberFormat(this.y, 0)} countries<br/>`;
        }
      },
      series: [
        { name: 'Daily count', data, lineWidth: 1, marker: { enabled: false } },
        { name: '7-day avg', data: smooth, lineWidth: 2, marker: { enabled: false } }
      ],
      annotations: [{
        labels: labels.map(p => ({
          point: { x: p.x, y: p.y, xAxis: 0, yAxis: 0 },
          text: Highcharts.dateFormat('%b %e', p.x),
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderColor: '#ddd',
          borderRadius: 6,
          padding: 4,
          style: { fontSize: '10px' }
        }))
      }]
    });
  }

  function renderMultiples(indexArray, continentByIso2) {
    const multSlot = document.getElementById('doy-multiples');
    if (!multSlot) return;

    // indexArray is [[dateISO, [ISO2,...]], ...]
    const byCont = new Map(ALL_CONTINENTS.map(c => [c, {}]));
    for (const [date, list] of indexArray) {
      const arr = Array.isArray(list) ? list : [];
      for (const iso2 of arr) {
        const cont = continentByIso2[String(iso2).toUpperCase()] || 'Other';
        if (!byCont.has(cont)) continue;
        const m = byCont.get(cont);
        m[date] = (m[date] || 0) + 1;
      }
    }

    // compute yMax across panes for consistent scale
    let yMax = 0;
    const panes = ALL_CONTINENTS.map(name => {
      const counts = byCont.get(name) || {};
      const s = seriesFromCounts(counts);
      yMax = Math.max(yMax, s.yMax);
      return { name, ...s };
    });

    // build containers
    multSlot.innerHTML = ''; multSlot.hidden = false;
    panes.forEach(p => {
      const div = document.createElement('div');
      div.className = 'doy-mini';
      div.style.height = '220px';
      multSlot.appendChild(div);
      Highcharts.chart(div, {
        chart: { type: 'line', height: 220, marginTop: 36 },
        title: { text: p.name, align: 'left', margin: 6, style: { fontSize: '12px' } },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
          type: 'datetime',
          tickInterval: 61 * 24 * 3600 * 1000,
          labels: { formatter: function(){ return Highcharts.dateFormat('%b', this.value);} }
        },
        yAxis: {
          title: { text: null },
          max: yMax || null,
          tickAmount: 3,
          gridLineWidth: 1
        },
        tooltip: {
          shared: true,
          xDateFormat: '%a, %b %e',
          pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y}</b><br/>'
        },
        series: [
          { name: 'Daily', data: p.data, lineWidth: 1, marker: { enabled: false } },
          { name: '7-day', data: p.smooth, lineWidth: 2, marker: { enabled: false } }
        ]
      });
    });
  }

})();
