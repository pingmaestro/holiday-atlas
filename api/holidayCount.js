// /api/holidayCount.js
export default async function handler(req, res) {
  try {
    // ---- Params & validation ----
    const iso2 = (req.query.iso2 || req.query.country || '').toString().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2)) {
      return res.status(400).json({ error: 'Bad iso2' });
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ error: 'Bad year' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Bad month' });
    }

    // New: scope = national | public | all  (default national)
    const scope = (req.query.scope || 'national').toString().toLowerCase();
    if (!['national', 'public', 'all'].includes(scope)) {
      return res.status(400).json({ error: 'Bad scope' });
    }

    // Back-compat: allow a raw Calendarific `type` param if provided,
    // but we only use it upstream (we still filter by `scope` below).
    const rawType = (req.query.type || '').toString().toLowerCase();
    const upstreamType =
      rawType ||
      (scope === 'national' ? 'national' : ''); // keep payload small for national

    // Env (support both names)
    const API_KEY =
      process.env.CALENDARIFIC_API_KEY || process.env.CALENDARIFIC_KEY;
    if (!API_KEY) {
      return res
        .status(500)
        .json({ error: 'Missing CALENDARIFIC_API_KEY (or CALENDARIFIC_KEY)' });
    }

    // ---- Simple server-side memo (per instance) ----
    const cacheKey = `${iso2}-${year}-${month}-${scope}`;
    globalThis.__memo ||= new Map();
    if (globalThis.__memo.has(cacheKey)) {
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate'); // 7 days
      return res.status(200).json(globalThis.__memo.get(cacheKey));
    }

    // ---- Upstream request ----
    const url = new URL('https://calendarific.com/api/v2/holidays');
    url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('country', iso2);
    url.searchParams.set('year', String(year));
    url.searchParams.set('month', String(month));
    if (upstreamType && ['national', 'local', 'religious', 'observance'].includes(upstreamType)) {
      url.searchParams.set('type', upstreamType);
    }

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      return res.status(502).json({ error: 'Upstream error', status: r.status });
    }
    const json = await r.json();
    if (json?.meta?.code !== 200) {
      return res.status(502).json({ error: 'Upstream meta error', meta: json?.meta });
    }

    const holidays = Array.isArray(json?.response?.holidays)
      ? json.response.holidays
      : [];

    // ---- Scope filter (national | public | all) ----
    const includeHoliday = (h) => {
      // Calendarific returns something like: type: ["National holiday"]
      const types = (h.type || []).map((t) => String(t).toLowerCase()).join(' ');
      if (scope === 'all') return true;
      if (scope === 'public') return /(national|federal|public|bank)/.test(types);
      return /(national|federal)/.test(types); // default: national/federal only
    };
    const filtered = holidays.filter(includeHoliday);

    // ---- De-dup "(observed)" entries by name+date ----
    const dedup = new Map();
    for (const h of filtered) {
      const name = (h.name || '').replace(/\s*\(observed\)/i, '');
      const dateIso =
        h?.date?.iso ||
        h?.date?.datetime?.iso ||
        h?.date?.datetime ||
        h?.date ||
        '';
      const k = `${dateIso}::${name}`;
      if (!dedup.has(k)) dedup.set(k, h);
    }
    const count = dedup.size;

    // Try to surface a country name if available
    const countryName =
      holidays[0]?.country?.name ||
      json?.response?.country?.name ||
      null;

    const out = { iso2, year, month, scope, name: countryName, count };

    // Cache & return
    globalThis.__memo.set(cacheKey, out);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
