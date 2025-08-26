export default async function handler(req, res) {
  try {
    const { iso2, year, month, type = 'national' } = req.query;
    if (!iso2 || !/^[A-Z]{2}$/.test(iso2)) {
      return res.status(400).json({ error: 'Bad iso2' });
    }
    const y = Number(year), m = Number(month);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) {
      return res.status(400).json({ error: 'Bad year' });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'Bad month' });
    }
    if (!['national', 'local', 'religious', 'observance'].includes(type)) {
      return res.status(400).json({ error: 'Bad type' });
    }

    const key = `${iso2}-${y}-${m}-${type}`;
    globalThis.__memo ||= new Map();
    if (globalThis.__memo.has(key)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.status(200).json(globalThis.__memo.get(key));
    }

    const url = new URL('https://calendarific.com/api/v2/holidays');
    url.searchParams.set('api_key', process.env.CALENDARIFIC_API_KEY);
    url.searchParams.set('country', iso2);
    url.searchParams.set('year', String(y));
    url.searchParams.set('month', String(m));
    url.searchParams.set('type', type);

    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) {
      return res.status(502).json({ error: 'Upstream error', status: r.status });
    }
    const json = await r.json();
    if (json?.meta?.code !== 200) {
      return res.status(502).json({ error: 'Upstream meta error' });
    }

    const holidays = json?.response?.holidays || [];
    const out = { iso2, year: y, month: m, type, name: null, count: holidays.length };
    if (holidays[0]?.country?.name) out.name = holidays[0].country.name;

    globalThis.__memo.set(key, out);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
}