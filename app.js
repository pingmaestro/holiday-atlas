(function () {
  // ---------- DOM refs ----------
  const tip = document.getElementById('tip');
  const monthSel = document.getElementById('month');
  const yearInput = document.getElementById('year');
  const scopeSel = document.getElementById('scope') || { value: 'national' };

  // ---------- Month controls ----------
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })
  );
  monthSel.innerHTML = months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const today = new Date();
  monthSel.value = String(today.getMonth() + 1);
  yearInput.value = String(today.getFullYear());

  // ---------- Map (Canvas renderer + no wrap to avoid horizontal artifacts) ----------
  const canvasRenderer = L.canvas({ padding: 0.5 });
  const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 2,
    maxZoom: 5,
    attribution: '\u00a9 OpenStreetMap',
    noWrap: true
  }).addTo(map);

  // ---------- Styling (keep stroke constant; change fill only on hover) ----------
  const baseStroke = { color: '#cfd7e6', weight: 0.6, lineJoin: 'round' };
  function styleNormal() { return { ...baseStroke, fillColor: '#f6f9ff', fillOpacity: 1 }; }
  function styleHover()  { return { ...baseStroke, fillColor: '#e9f1ff', fillOpacity: 1 }; }

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

  // ---------- Helpers (cache + ISO2 + API) ----------
  const cache = new Map(); // key: "CA-2025-8-public"
  function getISO2(feature) {
    const p = (feature && feature.properties) || {};
    const raw = p.iso2 || p.ISO2 || p.ISO_A2 || p.iso_a2 || p.iso_3166_1_alpha_2 || null;
    if (!raw || raw === '-99') return null;
    return String(raw).toUpperCase();
  }
  async function getHolidayCount(iso2, month, year, scope) {
    const s = (scope || 'national').toLowerCase();
    const key = `${iso2}-${year}-${month}-${s}`;
    if (cache.has(key)) return cache.get(key);
    const r = await fetch(`/api/holidayCount?iso2=${iso2}&month=${month}&year=${year}&scope=${encodeURIComponent(s)}`);
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

  // ---------- Load & render countries ----------
  async function loadMap() {
    const topoURL  = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
    const namesURL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/country-names.json';

    if (typeof topojson === 'undefined') {
      console.error('TopoJSON library not loaded.');
      return;
    }

    const [topoData, nameDataRaw] = await Promise.all([
      fetch(topoURL).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
      fetch(namesURL).then(r => (r.ok ? r.json() : [])).catch(() => [])
    ]);

    const nameData = Array.isArray(nameDataRaw) ? nameDataRaw : [];
    const byId = new Map(nameData.map(d => [+d.id, d])); // id -> { name, iso2? }
    const geo = topojson.feature(topoData, topoData.objects.countries);

    L.geoJSON(geo, {
      renderer: canvasRenderer,
      style: styleNormal,
      onEachFeature: (feature, layer) => {
        const meta = byId.get(+feature.id) || {};
        feature.properties.name = meta.name || feature.properties.name || 'Unknown';
        if (meta.iso2) {
          feature.properties.iso2 = meta.iso2;
          feature.properties.ISO_A2 = meta.iso2; // help getISO2()
        }

        const handleMove = throttle(async (e) => {
          const name  = feature.properties.name || 'Unknown';
          const iso2  = getISO2(feature);
          const month = Number(monthSel.value);
          const year  = Number(yearInput.value);
          const scope = (scopeSel.value || 'national').toLowerCase();
          const p     = e.originalEvent;

          if (!iso2) {
            setTip(p.clientX, p.clientY, `<strong>${name}</strong><span class="pill">—</span>`);
            return;
          }
          setTip(p.clientX, p.clientY, `<strong>${name}</strong><span class="pill">loading…</span>`);

          try {
            const { count, name: apiName } = await getHolidayCount(iso2, month, year, scope);
            const safeCount = count == null ? '—' : count;
            setTip(
              p.clientX, p.clientY,
              `<strong>${apiName || name}</strong>
               <span class="pill">${safeCount} ${scope === 'all' ? 'holidays' : `${scope} holidays`}</span>`
            );
          } catch {
            setTip(p.clientX, p.clientY, `<strong>${name}</strong><span class="pill">error</span>`);
          }
        }, 120);

        layer.on('mousemove', (e) => {
          layer.setStyle(styleHover());   // change fill only
          handleMove(e);
        });
        layer.on('mouseout', () => {
          layer.setStyle(styleNormal());
          hideTip();
        });
      }
    }).addTo(map);
  }

  // ---------- UI events ----------
  monthSel.addEventListener('change', hideTip);
  yearInput.addEventListener('change', hideTip);
  if (scopeSel && scopeSel.addEventListener) scopeSel.addEventListener('change', hideTip);

  // ---------- Boot ----------
  loadMap();
})();
