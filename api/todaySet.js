// /api/todaySet.js
export default async function handler(req, res) {
  try {
    // Parse & validate year (with fallback to current year)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const yParam = Number(url.searchParams.get('year'));
    const YEAR = Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
      ? yParam
      : new Date().getFullYear();

    // Build absolute URL to your totals file
    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const base = `${proto}://${req.headers.host}`;
    const totalsUrl = `${base}/data/totals-${YEAR}.json`;

    // Get ISO2 list from your totals data (no hardcoding)
    const totalsResp = await fetch(totalsUrl, { cache: 'no-store' });
    if (!totalsResp.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ today: [] });
    }
    const totalsJSON = await totalsResp.json();
    const iso2List = Object.keys(totalsJSON?.totals || {});
    if (!iso2List.length) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ today: [] });
    }

    // Query Nager.Date for each ISO2 (polite concurrency)
    const today = [];
    const limit = 10; // concurrency workers
    let i = 0;

    async function worker() {
      while (i < iso2List.length) {
        const iso2 = iso2List[i++];
        try {
          const r = await fetch(`https://date.nager.at/api/v3/IsTodayPublicHoliday/${iso2}`, { cache: 'no-store' });
          if (r.ok) {
            const isToday = await r.json(); // true/false
            if (isToday) today.push(iso2);
          }
        } catch (_) {
          // ignore individual errors
        }
      }
    }

    await Promise.all(Array.from({ length: limit }, worker));

    // Cache gently to avoid hammering (15 minutes)
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900');
    res.status(200).json({ today });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ today: [] });
  }
}
