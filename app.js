(function () {
  // ---------- DOM refs ----------
  const tip = document.getElementById('tip');
  const mapHost = document.getElementById('map');

  // ---------- Tooltip helpers ----------
  function setTip(x, y, html) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.setAttribute('aria-hidden', 'false');
  }
  function hideTip() {
    tip.style.display = 'none';
    tip.setAttribute('aria-hidden', 'true');
  }

  // ---------- Data cache (filled once on load) ----------
  const YEAR = 2025;
  let totals = {}; // { CA: {name, count}, ... }

  // ---------- Static SVG map ----------
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

    // Same GeoJSON as backend, includes ISO_A2 + NAME
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
      .style('cursor', 'default');

    const getISO2 = (p) => {
      const raw = p.ISO_A2 || p.iso_a2 || p.iso2 || p.cca2 || null;
      if (!raw || raw === '-99') return null;
      return String(raw).toUpperCase();
    };
    const getName = (p) =>
      p.NAME || p.ADMIN || p.name_long || p.name || 'Unknown';

    countries
      .on('mousemove', function (event, d) {
        d3.select(this).attr('fill', fillHover);

        const props = d.properties || {};
        const iso2  = getISO2(props);
        const name  = getName(props);
        const x = event.clientX, y = event.clientY;

        if (!iso2 || !totals[iso2]) {
          setTip(x, y, `<strong>${name}</strong><span class="pill">—</span>`);
          return;
        }

        const { count, name: apiName } = totals[iso2] || {};
        const safe = (count == null) ? '—' : count;
        setTip(
          x, y,
          `<strong>${apiName || name}</strong><span class="pill">${safe} holidays (2025)</span>`
        );
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill', fillNormal);
        hideTip();
      });

    // Redraw on container resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderMap, 150);
    }, { passive: true });
  }

  async function boot() {
    // One request to get ALL totals (cached at server + CDN)
    const r = await fetch(`/api/holidayTotals?year=${YEAR}`);
    const data = await r.json();
    totals = data.totals || {};
    await renderMap();
  }

  boot().catch(err => {
    console.error('Init failed:', err);
    mapHost.innerHTML = '<div class="note">Failed to load map.</div>';
  });
})();
