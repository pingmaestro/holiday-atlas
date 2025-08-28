// /api/holidayDetails.js
// Nager.Date details + cache. Adds `global` and `counties` for region filtering.
export default async function handler(req, res) {
  try {
    const iso2 = (req.query.iso2 || '').toString().toUpperCase();
    const year = Number(req.query.year || 2025);
    if (!/^[A-Z]{2}$/.test(iso2)) return res.status(400).json({ error: 'Bad iso2' });
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      return res.status(400).json({ error: 'Bad year' });
    }

    globalThis.__holidayDetails ||= new Map();
    const key = `${iso2}-${year}`;
    if (globalThis.__holidayDetails.has(key)) {
      res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
      return res.status(200).json(globalThis.__holidayDetails.get(key));
    }

    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${iso2}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return res.status(502).json({ error: 'Upstream error', status: r.status });

    const arr = await r.json();
    const holidays = (Array.isArray(arr) ? arr : [])
      .map(h => ({
        date: h.date,
        name: h.name,
        localName: h.localName,
        types: h.types || ['Public'],
        global: !!h.global,
        counties: Array.isArray(h.counties) ? h.counties.map(String) : null
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const out = { iso2, year, holidays };
    globalThis.__holidayDetails.set(key, out);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
