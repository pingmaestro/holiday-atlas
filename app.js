
(function () {
  // DOM refs
  const tip = document.getElementById('tip');
  const monthSel = document.getElementById('month');
  const yearInput = document.getElementById('year');

  // Month controls
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })
  );
  monthSel.innerHTML = months
    .map((m, i) => `<option value="${i + 1}">${m}</option>`)
    .join('');
  const today = new Date();
  monthSel.value = String(today.getMonth() + 1);
  yearInput.value = String(today.getFullYear());

  // Leaflet map
  const map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 2,
    maxZoom: 5,
    attribution: '\u00a9 OpenStreetMap',
  }).addTo(map);

  // Styling helpers
  function styleNormal() {
    return { color: '#cfd7e6', weight: 0.6, fillColor: '#f6f9ff', fillOpacity: 1 };
  }
  function styleHover() {
    return { color: '#0a60ff', weight: 1.2, fillColor: '#e9f1ff', fillOpacity: 1 };
  }

  // Client memo cache to avoid repeat calls while hovering
  const memo = new Map(); // key: iso2|year|month -> { count, name }
  function memoKey(iso2, y, m) {
    return `${iso2}|${y}|${m}`;
  }

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

  async function fetchCount(iso2) {
    const y = Number(yearInput.value),
      m = Number(monthSel.value);
    const key = memoKey(iso2, y, m);
    if (memo.has(key)) return memo.get(key);
    const url = `/api/holidayCount?iso2=${iso2}&year=${y}&month=${m}&type=national`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = { count: null, name: null };
      memo.set(key, err);
      return err;
    }
    const data = await res.json();
    memo.set(key, data);
    return data;
  }

  async function loadMap() {
    const topoURL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
    const namesURL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/country-names.json';
    const [topoData, nameData] = await Promise.all([
      fetch(topoURL).then((r) => r.json()),
      fetch(namesURL).then((r) => r.json()),
    ]);

    const byId = new Map(nameData.map((d) => [+d.id, d]));
    const geo = topojson.feature(topoData, topoData.objects.countries);

    const layer = L.geoJSON(geo, {
      style: styleNormal,
      onEachFeature: (feature, layer) => {
        const meta = byId.get(+feature.id) || {};
        feature.properties.name = meta.name || 'Unknown';
        feature.properties.iso2 = meta.iso2 || null;

        layer.on('mousemove', async (e) => {
          const { iso2, name } = feature.properties;
          if (!iso2) return;
          layer.setStyle(styleHover());
          const { count } = await fetchCount(iso2);
          const safe = count === null || count === undefined ? '—' : count;
          const p = e.originalEvent;
          setTip(
            p.clientX,
            p.clientY,
            `<strong>${name}</strong><span class="pill">${safe} holidays</span>`
          );
        });

        layer.on('mouseout', () => {
          layer.setStyle(styleNormal());
          hideTip();
        });
      },
    }).addTo(map);
  }

  // Recompute memo scope when month/year changes (do not clear old keys; they remain valid)
  monthSel.addEventListener('change', () => {
    hideTip();
  });
  yearInput.addEventListener('change', () => {
    hideTip();
  });

  loadMap();
})();