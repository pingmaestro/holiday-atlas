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

  // ---------- Region list UI under the map after click ----------
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
    const entries = Object.entries(m).sort((a,b) => b[1] - a[1]); // desc

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

  // ---------- Map render (choropleth + zoom on click) ----------
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

    // ----- Build color scale from national counts -----
    const hasCount = Object.entries(TOTALS)
      .map(([_, v]) => v && Number.isFinite(v.national) ? v.national : null)
      .filter(v => v !== null);

    const min = hasCount.length ? d3.min(hasCount) : 0;
    const max = hasCount.length ? d3.max(hasCount) : 1;
    const domain = (min === max) ? [min, min + 1] : [min, max];

    // 7-step green->blue palette (light to dark)
    const palette = d3.range(0, 1.00001, 1 / 6).map(t => d3.interpolateGnBu(t));
    const color = d3.scaleQuantize().domain(domain).range(palette);
    const noDataFill = '#d9d9d9'; // gray for missing data

    // ----- Draw countries -----
    const g = svg.append('g');

    const countries = g.selectAll('path.country')
      .data(geo.features)
      .enter()
      .append('path')
      .attr('class', 'country')
      .attr('d', path)
      .attr('fill', d => {
        const iso = getISO2(d.properties || {});
        const rec = iso && TOTALS[iso];
        const n = rec && Number.isFinite(rec.national) ? rec.national : null;
        return n === null ? noDataFill : color(n);
      })
      .attr('stroke', '#cfd7e6')
      .attr('stroke-width', 0.6)
      .attr('vector-effect', 'non-scaling-stroke')
      .style('cursor', 'pointer');

    // Hover: keep fill, just thicken stroke + tooltip (national + regional)
    countries
      .on('mousemove', function (event, d) {
        d3.select(this).attr('stroke-width', 1.0);
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
        d3.select(this).attr('stroke-width', 0.6);
        hideTip();
      })
      .on('click', async function (event, d) {
        // Zoom to country bounds
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

        // Fetch Nager.Date details if not cached
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

    // ----- Legend (discrete swatches) -----
    const legend = svg.append('g')
      .attr('transform', `translate(${width/2 - 140}, ${height - 28})`);

    const sw = 32, sh = 10, gap = 4;
    const thresholds = color.thresholds ? color.thresholds() : [];
    const labels = [domain[0], ...thresholds, domain[1]];

    legend.selectAll('rect.swatch')
      .data(palette)
      .enter()
      .append('rect')
      .attr('class', 'swatch')
      .attr('x', (_, i) => i * (sw + gap))
      .attr('y', 0)
      .attr('width', sw)
      .attr('height', sh)
      .attr('fill', d => d)
      .attr('stroke', '#cfd7e6');

    // min + max labels
    legend.append('text')
      .attr('x', 0).attr('y', sh + 12)
      .attr('class', 'note')
      .style('font-size', '12px')
      .text(Math.round(domain[0]));

    legend.append('text')
      .attr('x', (palette.length - 1) * (sw + gap))
      .attr('y', sh + 12)
      .attr('class', 'note')
      .style('text-anchor', 'end')
      .style('font-size', '12px')
      .text(Math.round(domain[1]));

    legend.append('text')
      .attr('x', (palette.length * (sw + gap)) / 2)
      .attr('y', sh + 26)
      .attr('class', 'note')
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .text('# of National Holidays');

    // Redraw on resize
    let t; window.addEventListener('resize', () => {
      clearTimeout(t); t = setTimeout(renderMap, 150);
    }, { passive: true });
  }

  async function boot() {
    // One local file
    const r = await fetch(`/data/totals-2025.json?v=${Date.now()}`, { cache: 'no-store' });
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
