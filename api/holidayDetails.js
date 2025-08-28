// /api/holidayDetails.js
// Returns detailed holidays for a country/year using Nager.Date (free, no key).
// Response: { iso2, year, holidays: [{ date, name, localName, types: [...], type: "national|bank|other" }] }

export default async function handler(req, res) {
  try {
    const iso2 = (req.query.iso2 || '').toString().toUpperCase();
    const year = Number(req.query.year || 2025);

    if (!/^[A-Z]{2}$/.test(iso2)) return res.status(400).json({ error: 'Bad iso2' });
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ error: 'Bad year' });
    }

    // In-memory cache (per instance)
    globalThis.__holidayDetails ||= new Map();
    const cacheKey = `${iso2}-${year}`;
    if (globalThis.__holidayDetails.has(cacheKey)) {
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate'); // 7 days
      return res.status(200).json(globalThis.__holidayDetails.get(cacheKey));
    }

    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${iso2}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error', status: r.status });

    const arr = await r.json();
    const norm = Array.isArray(arr) ? arr : [];

    const simplify = (types) => {
      const list = Array.isArray(types) ? types.map(s => String(s).toLowerCase()) : [];
      if (list.some(t => t.includes('bank'))) return 'bank';
      if (list.some(t => t.includes('public') || t.includes('national') || t.includes('federal'))) return 'national';
      return 'other';
    };

    const holidays = norm
      .map(h => ({
        date: h.date,                 // "YYYY-MM-DD"
        name: h.name,                 // English/global name
        localName: h.localName,       // Local name if provided
        types: h.types || ['Public'], // Nager.Date v3
        type: simplify(h.types || ['Public'])
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const out = { iso2, year, holidays };

    globalThis.__holidayDetails.set(cacheKey, out);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate'); // 7 days CDN cache
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}