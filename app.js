(function () {
  // ---------- DOM refs ----------
  const tip = document.getElementById('tip');
  const monthSel = document.getElementById('month');
  const yearInput = document.getElementById('year');
  const scopeSel = document.getElementById('scope') || { value: 'national' };
  const mapHost = document.getElementById('map');

  // ---------- Month controls ----------
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })
  );
  monthSel.innerHTML = months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const today = new Date();
  monthSel.value = String(today.getMonth() + 1);
  yearInput.value = String(today.getFullYear());

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

  // ---------- API helpers (cache + fetch) ----------
  const cache = new Map(); // key: "CA-2025-8-public"
  async function getHolidayCount(iso2, month, year, scope) {
    const s = (scope || 'national').toLowerCase();
    const key = `${iso2}-${year}-${month}-${s}`;
    if (cache.has(key)) return cache.get(key);

    const r = await fetch(
      `/api/holidayCount?iso2=${iso2}&month=${month}&year=${year}&scope=${encodeURIComponent(s)}`
    );
    if (!r.ok) {
      const fallback = { count: null, name: null };
      cache.set(key, fallback);
      return fallback;
    }
    const data = await r.json();
    cache.set(key, data);
    return data;
  }
  const throttle = (fn, ms) => {
    let t = 0, timer = null;
    return function (...args) {
      const now = Date.now(), wait = t + ms - now;
      if (wait <= 0) { t = now; return fn.apply(this, args); }
      clearTimeout(timer);
      timer = setTimeout(() => { t = Date.now(); fn.apply(this, args); }, wait);
    };
  };

  // ---------- Static SVG map (GeoJSON, no zoom/pan) ----------
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

    // ✅ Natural Earth admin-0 countries with ISO_A2 + NAME props
    const WORLD_URL = 'https://cdn.jsdelivr.net/npm/three-conic-polygon-geometry@1.4.4/example/geojson/ne_110m_admin_0_countries.geojson';

    const geo = await fetch(WORLD_URL).then(r => {
      if (!r.ok) throw new Error(`GeoJSON fetch failed: ${r.status}`);
      return r.json();
    });

    projection.fitSize([width, height], geo);

    // Styles
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

    const getISO2 = (props) => {
      const raw = props.ISO_A2 || props.iso_a2 || props.iso2 || props.cca2 || null;
      if (!raw || raw === '-99') return null;   // Natural Earth uses -99 for some territories
      return String(raw).toUpperCase();
    };
    const getName = (props) =>
      props.NAME || props.ADMIN || props.name_long || props.name || 'Unknown';

    const onMove = throttle(async function (event, d) {
      const props = d.properties || {};
      const iso2  = getISO2(props);
      const name  = getName(props);
      const x = event.clientX, y = event.clientY;

      if (!iso2 || iso2 === 'XK') {
        setTip(x, y, `<strong>${name}</strong><span class="pill">—</span>`);
        return;
      }

      setTip(x, y, `<strong>${name}</strong><span class="pill">loading…</span>`);

      const month = Number(monthSel.value);
      const year  = Number(yearInput.value);
      const scope = (scopeSel.value || 'national').toLowerCase();

      try {
        const { count, name: apiName } = await getHolidayCount(iso2, month, year, scope);
        const safe = count == null ? '—' : count;
        setTip(
          x, y,
          `<strong>${apiName || name}</strong>
           <span class="pill">${safe} ${scope === 'all' ? 'holidays' : `${scope} holidays`}</span>`
        );
      } catch {
        setTip(x, y, `<strong>${name}</strong><span class="pill">error</span>`);
      }
    }, 120);

    countries
      .on('mousemove', function (event, d) {
        d3.select(this).attr('fill', fillHover);
        onMove(event, d);
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

  // ---------- UI events ----------
  monthSel.addEventListener('change', hideTip);
  yearInput.addEventListener('change', hideTip);
  if (scopeSel && scopeSel.addEventListener) scopeSel.addEventListener('change', hideTip);

  // ---------- Boot ----------
  renderMap().catch(err => {
    console.error('Map init failed:', err);
    mapHost.innerHTML = '<div class="note">Failed to load map data.</div>';
  });
})();
