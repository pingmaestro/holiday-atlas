(function () {
  const tip = document.getElementById('tip');
  const mapHost = document.getElementById('map');
  const detailsEl = document.getElementById('details');
  const detailsTitle = document.getElementById('details-title');
  const detailsBody = document.getElementById('details-body');

  const YEAR = 2025;
  let TOTALS = {};   // { CA: { name, national, regional }, ... }
  let REGIONS = {};  // { CA: { "CA-ON": 4, "CA-QC": 3, ... }, ... }
  const detailsCache = new Map(); // "CA-2025" -> holidays[]

  // ---------- Tooltip helpers ----------
  function setTip(x, y, html) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.setAttribute('aria-hidden', 'false');
  }
  function hideTip() { tip.style.display = 'none'; tip.setAttribute('aria-hidden', 'true'); }

  // ---------- Geo helpers ----------
  const getISO2 = (p) => {
    const raw = p.ISO_A2 || p.iso_a2 || p.iso2 || p.cca2 || null;
    if (!raw || raw === '-99') return null;
    return String(raw).toUpperCase();
  };
  const getName = (p) => p.NAME || p.ADMIN || p.name_long || p.name || 'Unknown';

  // ---------- Details rendering (with optional region filter) ----------
  function renderDetails(iso2, displayName, holidays, regionCode = null) {
    detailsEl.style.display = 'block';
    const regionSuffix = regionCode ? ` — ${regionCode}` : '';
    detailsTitle.textContent = `${displayName}${regionSuffix} — Holidays (${YEAR})`;

    let list = holidays || [];
    if (regionCode) {
      list = list.filter(h => Array.isArray(h.counties) && h.counties.includes(regionCode));
    }

    if (!list.length) {
      detailsBody.innerHTML = `<div class="note">No data available.</div>`;
      return;
    }

    const rows = list.map(h => {
      const pretty = new Date(h.date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
      const nm = h.localName && h.localName !== h.name
        ? `${h.name} <span class="note">(${h.localName})</span>`
        : h.name;
      const scope = h.global ? 'national' : 'regional';
      return `<div class="row">
        <div class="cell">${pretty}</div>
        <div class="cell">${nm}</div>
        <div class="cell"><span class="pill">${scope}</span></div>
      </div>`;
    }).join('');

    detailsBody.innerHTML = rows;
  }

  // ---------- Build region list UI under the map on click ----------
  function renderRegionList(iso2) {
    const mapBelow = document.getElementById('region-list') || (() => {
      const el = document.createElement('div');
      el.id = 'region-list';
      el.className = 'card';
      el.style.marginTop = '16px';
      el.innerHTML = `<div class="hd"><strong>States / Provinces</strong></div><div class="bd"><div id="region-rows" class="rows"></div></div>`;
      mapHost.parentElement.appendChild(el);
      return el;
    })();

    const rows = document.getElementById('region-rows');
    const m = REGIONS[iso2] || {};
    const entries = Object.entries(m).sort((a,b) => b[1] - a[1]); // desc by count

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

    // Hover shows a small native title; click filters details
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

  // ---------- Map render (static SVG, country zoom on click) ----------
  async function renderMap() {
    mapHost.innerHTML = '';

    const width = mapHost.clientWidth || 960;
    const height = 520;

    const svg = d3.select(mapHost)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('height', `${height}px`);

    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection);

    const WORLD_URL =
      'https://cdn.jsdelivr.net/npm/three-conic-polygon-geometry@1.4.4/example/geojson/ne_110m_admin_0_countries.geojson';
    const geo = await fetch(WORLD_URL).then(r => r.json());

    projection.fitSize([width, height], geo);

    const fillNormal = '#f6f9ff';
    const fillHover  = '#e9f1ff';
    const stroke     = '#cfd7e6';

    const g = svg.append('g');

    const countries = g.selectAll('path.country')
      .data(geo.features)
      .enter()
      .append('path')
      .attr('class', 'country')
      .attr('d', path)
      .attr('fill', fillNormal)
      .attr('stroke', stroke)
      .attr('stroke-width', 0.6)
      .attr('vector-effect', 'non-scaling-stroke')
      .style('cursor', 'pointer');

    // Hover: show national + regional counts
    countries
      .on('mousemove', function (event, d) {
        d3.select(this).attr('fill', fillHover);
        const p = d.properties || {};
        const iso2 = getISO2(p);
        const fallbackName = getName(p);
        const rec = iso2 ? TOTALS[iso2] : null;
        const label = (rec && rec.name) || fallbackName;
        const national = (rec && Number.isFinite(rec.national)) ? rec.national : '—';
        const regional = (rec && Number.isFinite(rec.regional)) ? rec.regional : '—';
        setTip(
          event.clientX,
          event.clientY,
          `<strong>${label}</strong>
           <div class="stack">
             <span class="pill">${national} national</span>
             <span class="pill">${regional} regional</span>
           </div>`
        );
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill', fillNormal);
        hideTip();
      })
      .on('click', async function (event, d) {
        // Zoom to country
        const b = path.bounds(d); // [[x0,y0],[x1,y1]]
        const dx = b[1][0] - b[0][0];
        const dy = b[1][1] - b[0][1];
        const cx = (b[0][0] + b[1][0]) / 2;
        const cy = (b[0][1] + b[1][1]) / 2;
        const scale = 0.9 / Math.max(dx / width, dy / height);

        g.transition().duration(550)
          .attr('transform', `translate(${width/2},${height/2}) scale(${scale}) translate(${-cx},${-cy})`);

        const p = d.properties || {};
        const iso2 = getISO2(p);
        const name = (iso2 && TOTALS[iso2]?.name) || getName(p);
        if (!iso2) return;

        // Fetch details if not cached, then render full list
        const cacheKey = `${iso2}-${YEAR}`;
        if (!detailsCache.has(cacheKey)) {
          try {
            const r = await fetch(`/api/holidayDetails?iso2=${iso2}&year=${YEAR}`);
            if (!r.ok) throw new Error(`details ${r.status}`);
            const data = await r.json();
            detailsCache.set(cacheKey, data.holidays || []);
          } catch {
            detailsCache.set(cacheKey, []);
          }
        }
        renderDetails(iso2, name, detailsCache.get(cacheKey), null);
        renderRegionList(iso2);
        detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

    // Reset zoom on background dblclick
    svg.on('dblclick', () => {
      g.transition().duration(400).attr('transform', null);
    });

    // Redraw on resize
    let t; window.addEventListener('resize', () => {
      clearTimeout(t); t = setTimeout(renderMap, 150);
    }, { passive: true });
  }

  async function boot() {
    // One local file
    const r = await fetch('/data/totals-2025.json');
    const data = await r.json();
    TOTALS  = data.totals  || {};
    REGIONS = data.regions || {};
    await renderMap();
  }

  boot().catch(err => {
    console.error('Init failed:', err);
    mapHost.innerHTML = '<div class="note">Failed to load map.</div>';
  });
})();
