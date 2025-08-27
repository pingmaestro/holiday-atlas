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
  const cache = new Map(); // key: "CA-2025-8-public" -> data
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

  // ---------- Static SVG map (no zoom/pan) ----------
  async function renderMap() {
    // Clean container
    mapHost.innerHTML = '';

    const width = mapHost.clientWidth || 960;
    const height = 520;

    const svg = d3.select(mapHost)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('width', '100%')
      .style('height', `${height}px`);

    // Natural Earth projection looks nice + static
    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection);

    // World countries with ISO2 codes (cca2) and human names (name.common)
    const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-countries@4.0.0/countries.geo.json';
    const geo = await fetch(WORLD_URL).then(r => r.json());

    // Fit projection to our viewport
    projection.fitSize([width, height], geo);

    // Styles
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
      .attr('vector-effect', 'non-scaling-stroke') // keeps borders thin when resized
      .style('cursor', 'default');

    const onMove = throttle(async function (event, d) {
      const iso2 = (d.properties.cca2 || '').toUpperCase();
      const name = d.properties?.name?.common || d.properties?.name || 'Unknown';

      // Tooltip position
      const x = event.clientX;
      const y = event.clientY;

      if (!iso2 || iso2 === 'XK') { // XK (Kosovo) often lacks upstream data
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
      .on('mousemove', function (event) {
        d3.select(this).attr('fill', fillHover);
        onMove.call(this, event, d3.select(this).datum());
      })
      .on('mouseout', function () {
        d3.select(this).attr('fill', fillNormal);
        hideTip();
      });

    // Redraw on container resize (keeps it crisp)
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
  renderMap();
})();
