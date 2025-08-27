// /api/holidayTotals.js
export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const year  = Number(req.query.year || 2025);
    const scope = 'national'; // fixed (no filters for now)

    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ error: 'Bad year' });
    }

    const API_KEY =
      process.env.CALENDARIFIC_API_KEY || process.env.CALENDARIFIC_KEY;
    if (!API_KEY) {
      return res
        .status(500)
        .json({ error: 'Missing CALENDARIFIC_API_KEY (or CALENDARIFIC_KEY)' });
    }

    // Simple server-side memo by year
    globalThis.__yearTotals ||= new Map();
    if (globalThis.__yearTotals.has(year)) {
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
      return res.status(200).json(globalThis.__yearTotals.get(year));
    }

    // Get world countries (GeoJSON) -> provides ISO_A2 + NAME
    const WORLD_URL =
      'https://cdn.jsdelivr.net/npm/three-conic-polygon-geometry@1.4.4/example/geojson/ne_110m_admin_0_countries.geojson';
    const world = await fetch(WORLD_URL).then((r) => r.json());

    const entries = [];
    for (const f of world.features || []) {
      const p = f.properties || {};
      const iso2Raw =
        p.ISO_A2 || p.iso_a2 || p.iso2 || p.cca2 || '';
      const iso2 = String(iso2Raw).toUpperCase();
      if (!iso2 || iso2 === '-99' || iso2 === 'XK') continue; // skip invalid
      const name =
        p.NAME || p.ADMIN || p.name_long || p.name || 'Unknown';
      entries.push({ iso2, name });
    }

    // helper: filter by scope & de-dupe "(observed)"
    const includeHoliday = (h) => {
      const types = (h.type || []).map((t) => String(t).toLowerCase()).join(' ');
      return /(national|federal)/.test(types); // fixed 'national'
    };
    const countHolidays = (holidays) => {
      const dedup = new Map();
      for (const h of holidays) {
        if (!includeHoliday(h)) continue;
        const nm = (h.name || '').replace(/\s*\(observed\)/i, '');
        const iso = h?.date?.iso || h?.date?.datetime?.iso || '';
        const k = `${iso}::${nm}`;
        if (!dedup.has(k)) dedup.set(k, 1);
      }
      return dedup.size;
    };

    // Calendarific per-country fetch
    const fetchCountry = async ({ iso2, name }) => {
      const url = new URL('https://calendarific.com/api/v2/holidays');
      url.searchParams.set('api_key', API_KEY);
      url.searchParams.set('country', iso2);
      url.searchParams.set('year', String(year));

      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { iso2, name, count: null, ok: false };

      const json = await r.json();
      if (json?.meta?.code !== 200) return { iso2, name, count: null, ok: false };

      const holidays = Array.isArray(json?.response?.holidays)
        ? json.response.holidays
        : [];
      const count = countHolidays(holidays);
      return { iso2, name, count, ok: true };
    };

    // Concurrency limiter (keeps function within time limits)
    const MAX_CONCURRENCY = 6;
    const results = [];
    let i = 0;
    async function worker() {
      while (i < entries.length) {
        const idx = i++;
        results[idx] = await fetchCountry(entries[idx]).catch(() => ({
          iso2: entries[idx].iso2,
          name: entries[idx].name,
          count: null,
          ok: false,
        }));
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENCY }, worker));

    // Build totals map
    const totals = {};
    let okCount = 0;
    for (const r of results) {
      if (!r) continue;
      totals[r.iso2] = { name: r.name, count: r.count };
      if (r.ok) okCount++;
    }

    const out = {
      year,
      scope,
      totals,
      metrics: {
        countriesAttempted: entries.length,
        countriesOk: okCount,
        durationMs: Date.now() - t0,
      },
      updatedAt: new Date().toISOString(),
    };

    // Cache & return
    globalThis.__yearTotals.set(year, out);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
