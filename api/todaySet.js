// /api/todaySet.js
// Hardened: overall timeout, per-fetch timeouts, polite concurrency, in-memory caching

const TTL_MS = 15 * 60 * 1000;        // 15 minutes for the "today" set
const PER_FETCH_TIMEOUT_MS = 4500;    // timeout per Nager request
const OVERALL_TIMEOUT_MS = 12000;     // hard cap for the whole endpoint
const CONCURRENCY = 10;               // polite parallelism

// In-memory caches (per server instance)
globalThis.__todayCache = globalThis.__todayCache || {};   // { [year]: { at:number, list:string[] } }
globalThis.__iso2Cache  = globalThis.__iso2Cache  || {};   // { [year]: { at:number, iso2:string[] } }

function parseYear(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const yParam = Number(url.searchParams.get('year'));
    if (Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100) return yParam;
  } catch {}
  return new Date().getFullYear();
}

function buildOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function timeoutFetch(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function getIso2ListForYear(req, year) {
  const now = Date.now();
  const cached = globalThis.__iso2Cache[year];
  if (cached && now - cached.at < TTL_MS && Array.isArray(cached.iso2) && cached.iso2.length) {
    return cached.iso2;
  }
  const origin = buildOrigin(req);
  const totalsUrl = `${origin}/data/totals-${year}.json`;
  try {
    const r = await timeoutFetch(totalsUrl, 4000, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Totals ${r.status}`);
    const json = await r.json();
    const iso2 = Object.keys(json?.totals || {});
    globalThis.__iso2Cache[year] = { at: now, iso2 };
    return iso2;
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Overall timeout guard
  const overall = setTimeout(() => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(JSON.stringify({ today: [], generatedAt: new Date().toISOString(), ttlSeconds: 0 }));
    } catch {}
  }, OVERALL_TIMEOUT_MS);

  try {
    const YEAR = parseYear(req);
    const now = Date.now();

    // Serve warm cache if fresh
    const cached = globalThis.__todayCache[YEAR];
    if (cached && now - cached.at < TTL_MS && Array.isArray(cached.list)) {
      clearTimeout(overall);
      res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900');
      return res.status(200).json({
        today: cached.list.slice().sort(),
        year: YEAR,
        generatedAt: new Date(cached.at).toISOString(),
        ttlSeconds: Math.max(0, Math.floor((TTL_MS - (now - cached.at)) / 1000))
      });
    }

    // Get ISO2 universe from your totals file (no hardcoding)
    const iso2List = await getIso2ListForYear(req, YEAR);
    if (!iso2List.length) {
      clearTimeout(overall);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ today: [], year: YEAR, generatedAt: new Date().toISOString(), ttlSeconds: 0 });
    }

    // Polite concurrent crawl of Nager IsTodayPublicHoliday
    const today = [];
    let i = 0;

    async function worker() {
      while (i < iso2List.length) {
        const iso2 = iso2List[i++];
        try {
          const r = await timeoutFetch(`https://date.nager.at/api/v3/IsTodayPublicHoliday/${iso2}`, PER_FETCH_TIMEOUT_MS, { cache: 'no-store' });
          if (!r.ok) continue;
          const isToday = await r.json(); // boolean
          if (isToday) today.push(iso2);
        } catch {
          // swallow individual timeouts/errors
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Store in cache and respond
    globalThis.__todayCache[YEAR] = { at: now, list: today.slice() };

    clearTimeout(overall);
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900');
    res.status(200).json({
      today: today.slice().sort(),
      year: YEAR,
      generatedAt: new Date(now).toISOString(),
      ttlSeconds: Math.floor(TTL_MS / 1000)
    });
  } catch {
    clearTimeout(overall);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ today: [], generatedAt: new Date().toISOString(), ttlSeconds: 0 });
  }
}
