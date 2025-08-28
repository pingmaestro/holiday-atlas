(function () {
  const tip = document.getElementById('tip');
  const mapHost = document.getElementById('map');
  const detailsEl = document.getElementById('details');
  const detailsTitle = document.getElementById('details-title');
  const detailsBody = document.getElementById('details-body');

  function setTip(x, y, html) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.setAttribute('aria-hidden', 'false');
  }
  function hideTip() { tip.style.display = 'none'; tip.setAttribute('aria-hidden', 'true'); }

  const YEAR = 2025;
  let TOTALS = {};                 // { US: {name, count}, ... }
  const detailsCache = new Map();  // "US-2025" -> holidays[]

  const getISO2 = (p) => {
    const raw = p.ISO_A2 || p.iso_a2 || p.iso2 || p.cca2 || null;
    if (!raw || raw === '-99') return null;
    return String(raw).toUpperCase();
  };
  const getName = (p) => p.NAME || p.ADMIN || p.name_long || p.name || 'Unknown';

  function renderDetails(iso2, displayName, holidays) {
    detailsEl.style.display = 'block';
    detailsTitle.textContent = `${displayName} — Holidays (${YEAR})`;

    if (!Array.isArray(holidays) || holidays.length === 0) {
      detailsBody.innerHTML = `<div class="note">No data available.</div>`;
      return;
    }

    const rows = holidays.map(h => {
      const pretty = new Date(h.date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
      const name = h.localName && h.localName !== h.name
        ? `${h.name} <span class="note">(${h.localName})</span>`
        : h.name;
      return `<div class="row">
        <div class="cell">${pretty}</div>
        <div class="cell">${name}</div>
        <div class="cell"><span class="pill">${h.type}</span></div>
      </div>`;
    }).join('');

    detailsBody.innerHTML = rows;
  }

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

    // Geo with ISO_A2 + NAME props
    const WORLD_URL =
      'https://cdn.jsdelivr.net/npm/three-conic-polygon-geometry@1.4.4/example/geojson/ne_110m_admin_0_countries.geojson';
    const geo = await fetch(WORLD_URL).then(r => r.json());

    projection.fitSize([width, height], geo);

    const fillNormal = '#f6f9ff';
    const fillHover  = '#e9f1ff';
    const stroke     = '#cfd7e6';

    const countries = svg.append('g')
      .selectAll('path.country')
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

    countries
      .on('mousemove', function (event, d) {
        d3.select(this).attr('fill', fillHover);
        const p = d.properties || {};
        const iso2 = getISO2(p);
        const fallbackName = getName(p);
        const rec = iso2 ? TOTALS[iso2] : null;
        const label = (rec && rec.name) || fallbackName;
        const count = rec && Number.isFinite(rec.count) ? rec.count : '—';
        setTip(event.clientX, event.clientY, `<strong>${label}</strong><span class="pill">${count} holidays (2025)</span>`);
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill', fillNormal);
        hideTip();
      })
      .on('click', async function (event, d) {
        const p = d.properties || {};
        const iso2 = getISO2(p);
        const name = (iso2 && TOTALS[iso2]?.name) || getName(p);
        if (!iso2) return;

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
        renderDetails(iso2, name, detailsCache.get(cacheKey));
        detailsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

    // Redraw on resize
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderMap, 150); }, { passive: true });
  }

  async function boot() {
    // One local request (no external API)
    const r = await fetch('/data/totals-2025.json');
    const data = await r.json();
    TOTALS = data.totals || {};
    await renderMap();
  }

  boot().catch(err => {
    console.error('Init failed:', err);
    mapHost.innerHTML = '<div class="note">Failed to load map.</div>';
  });
})();
