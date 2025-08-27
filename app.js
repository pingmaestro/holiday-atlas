(function () {
  // ---------- DOM refs ----------
  const tip = document.getElementById('tip');
  const monthSel = document.getElementById('month');
  const yearInput = document.getElementById('year');
  // Optional: if #scope doesn't exist in HTML yet, default to national
  const scopeSel = document.getElementById('scope') || { value: 'national' };

  // ---------- Month controls ----------
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })
  );
  monthSel.innerHTML = months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const today = new Date();
  monthSel.value = String(today.getMonth() + 1);
  yearInput.value = String(today.getFullYear());

  // ---------- Leaflet map ----------
  const map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 2,
    maxZoom: 5,
    attribution: '\u00a9 OpenStreetMap',
  }).addTo(map);

  // ---------- Styling ----------
  function styleNormal() {
    return { color: '#cfd7e6', weight: 0.6, fillColor: '#f6f9ff', fillOpacity: 1 };
  }
  function styleHover() {
    return { color: '#0a60ff', weight: 1.2, fillColor: '#e9f1ff', fillOpacity: 1 };
  }

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
  // cache key: "CA-2024-1-public"  ->  { count, name, ... }
  const cache = new Map();

  function getISO2(feature) {
    const p = (feature && feature.properties) || {};
    const raw =
      p.iso2 || p.ISO2 || p.ISO_A2 || p.iso_a2 || p.iso_3166_1_alpha_2 || null;
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

  // ---------- Load & render countries ----------
  async function loadMap() {
    const topoURL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
    const namesURL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/country-names.json';

    const [topoData, nameData] = await Promise.all([
      fetch(topoURL).then((r) => r.json()),
      fetch(namesURL).then((r) => r.json()),
    ]);

    const byId = new Map(nameData.map((d) => [+d.id, d])); // id -> { name, iso2 }
    const geo = topojson.feature(topoData, topoData.objects.countries);

    L.geoJSON(geo, {
      style: styleNormal,
      onEachFeature: (feature, layer) => {
        const meta = byId.get(+feature.id) || {};
        feature.properties.name = meta.name || 'Unknown';
        feature.properties.iso2 = meta.iso2 || feature.properties.iso2 || null;

        layer.on('mousemove', async (e) => {
          const iso2 = getISO2(feature);
          if (!iso2) return;

          layer.setStyle(styleHover());

          const month = Number(monthSel.value);
          const year  = Number(yearInput.value);
          const scope = (scopeSel.value || 'national').toLowerCase();

          try {
            const { count, name } = await getHolidayCount(iso2, month, year, scope);
            const safeCount = count == null ? '—' : count;
            const p = e.originalEvent;
            setTip(
              p.clientX,
              p.clientY,
              `<strong>${name || feature.properties.name}</strong>
               <span class="pill">${safeCount} ${scope === 'all' ? 'holidays' : `${scope} holidays`}</span>`
            );
          } catch (err) {
            console.error(err);
          }
        });

        layer.on('mouseout', () => {
          layer.setStyle(styleNormal());
          hideTip();
        });
      },
    }).addTo(map);
  }

  // ---------- UI events ----------
  monthSel.addEventListener('change', hideTip);
  yearInput.addEventListener('change', hideTip);
  if (scopeSel && scopeSel.addEventListener) {
    scopeSel.addEventListener('change', hideTip);
  }

  // ---------- Boot ----------
  loadMap();
})();
