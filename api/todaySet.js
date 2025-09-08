// /pages/api/todaySet.js
// Returns: { today: ["AL","FR", ...], date, year, mode, tz, items: [{iso2, name}] }
//
// Query:
//   ?year=2025
//   &mode=local                 → each country’s local date (default; previous behavior)
//   &mode=global&tz=Area/City   → same anchored date for every country, computed in tz
//   &date=YYYY-MM-DD            → OPTIONAL: overrides the target date entirely (UTC)

import fs from 'node:fs';
import path from 'node:path';

const COUNTRY_TZ = {
  // (same table you had)
  AL:'Europe/Tirane', AD:'Europe/Andorra', AT:'Europe/Vienna', BE:'Europe/Brussels',
  BG:'Europe/Sofia', CH:'Europe/Zurich', CY:'Asia/Nicosia', CZ:'Europe/Prague',
  DE:'Europe/Berlin', DK:'Europe/Copenhagen', EE:'Europe/Tallinn', ES:'Europe/Madrid',
  FI:'Europe/Helsinki', FR:'Europe/Paris', GB:'Europe/London', GR:'Europe/Athens',
  HR:'Europe/Zagreb', HU:'Europe/Budapest', IE:'Europe/Dublin', IS:'Atlantic/Reykjavik',
  IT:'Europe/Rome', LT:'Europe/Vilnius', LU:'Europe/Luxembourg', LV:'Europe/Riga',
  MT:'Europe/Malta', NL:'Europe/Amsterdam', NO:'Europe/Oslo', PL:'Europe/Warsaw',
  PT:'Europe/Lisbon', RO:'Europe/Bucharest', RS:'Europe/Belgrade', SE:'Europe/Stockholm',
  SI:'Europe/Ljubljana', SK:'Europe/Bratislava', UA:'Europe/Kyiv',
  AR:'America/Argentina/Buenos_Aires', BO:'America/La_Paz', BR:'America/Sao_Paulo',
  CA:'America/Toronto', CL:'America/Santiago', CO:'America/Bogota',
  MX:'America/Mexico_City', PE:'America/Lima', UY:'America/Montevideo', US:'America/New_York',
  DZ:'Africa/Algiers', EG:'Africa/Cairo', ET:'Africa/Addis_Ababa', GH:'Africa/Accra',
  KE:'Africa/Nairobi', MA:'Africa/Casablanca', NG:'Africa/Lagos', ZA:'Africa/Johannesburg', TN:'Africa/Tunis',
  AE:'Asia/Dubai', AM:'Asia/Yerevan', AZ:'Asia/Baku', BH:'Asia/Bahrain', BD:'Asia/Dhaka',
  CN:'Asia/Shanghai', HK:'Asia/Hong_Kong', IN:'Asia/Kolkata', ID:'Asia/Jakarta', IL:'Asia/Jerusalem',
  IQ:'Asia/Baghdad', IR:'Asia/Tehran', JP:'Asia/Tokyo', JO:'Asia/Amman', KR:'Asia/Seoul',
  KW:'Asia/Kuwait', KZ:'Asia/Almaty', LB:'Asia/Beirut', MY:'Asia/Kuala_Lumpur', NP:'Asia/Kathmandu',
  OM:'Asia/Muscat', PH:'Asia/Manila', PK:'Asia/Karachi', QA:'Asia/Qatar', RU:'Europe/Moscow',
  SA:'Asia/Riyadh', SG:'Asia/Singapore', TH:'Asia/Bangkok', TR:'Europe/Istanbul', TW:'Asia/Taipei', VN:'Asia/Ho_Chi_Minh',
  AU:'Australia/Sydney', NZ:'Pacific/Auckland'
};

function dateStrInTZ(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default async function handler(req, res) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const mode = String(req.query.mode || 'local').toLowerCase(); // 'local' | 'global'
    const anchorTZ = req.query.tz ? String(req.query.tz) : null;

    // NEW: optional explicit date override (UTC plain date)
    const dateParam = typeof req.query.date === 'string' ? req.query.date : null;
    const hasExplicitDate = !!(dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam));

    const totalsPath = path.join(process.cwd(), 'public', 'data', `totals-${year}.json`);
    const totalsJson = JSON.parse(fs.readFileSync(totalsPath, 'utf8'));
    const totals = totalsJson.totals || totalsJson || {};
    const iso2List = Array.isArray(totals) ? totals.map(x => x.iso2 || x.code).filter(Boolean) : Object.keys(totals);

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host  = req.headers.host;
    const base  = `${proto}://${host}`;

    const now = new Date();
    const anchorDateStr = (mode === 'global' && anchorTZ) ? dateStrInTZ(now, anchorTZ) : null;

    // We’ll also return items for the matched date
    const matchedISO2 = [];
    const matchedItems = [];

    const results = await Promise.allSettled(
      iso2List.map(async (iso2) => {
        const tz = COUNTRY_TZ[iso2] || 'UTC';

        // Target date per country:
        const targetDateStr = hasExplicitDate
          ? dateParam                              // exact date provided by caller
          : (mode === 'global' && anchorTZ)
              ? anchorDateStr                      // same date for all countries in the given tz
              : dateStrInTZ(now, tz);              // per-country local date (original behavior)

        const r = await fetch(`${base}/api/holidayDetails?iso2=${iso2}&year=${year}`, { cache: 'no-store' });
        if (!r.ok) return null;
        const data = await r.json();
        const holidays = Array.isArray(data.holidays) ? data.holidays : [];

        // Keep national-only as you had (global === true)
        const national = holidays.filter(h => h && h.global === true && typeof h.date === 'string');

        // collect items for this date (names used in your right panel)
        const todays = national.filter(h => h.date === targetDateStr);
        if (todays.length > 0) {
          todays.forEach(h => matchedItems.push({ iso2, name: h.name || h.localName || 'Holiday' }));
          return iso2;
        }
        return null;
      })
    );

    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) matchedISO2.push(r.value);
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      year,
      date: hasExplicitDate ? dateParam : (mode === 'global' ? anchorDateStr : null),
      mode,
      tz: (mode === 'global' ? anchorTZ : 'local'),
      today: matchedISO2.sort(),
      items: matchedItems   // [{ iso2, name }] for the matched date
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ today: [], items: [] });
  }
}
