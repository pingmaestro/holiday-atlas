// pages/api/todaySet.js  (Next.js Pages Router)
// Returns: { today: ["AL","FR",... ] }

import fs from 'node:fs';
import path from 'node:path';

// Minimal ISO2 → IANA timezone map (covering many; fallback to UTC).
// Add/adjust freely — unknown codes default to 'UTC'.
const COUNTRY_TZ = {
  // Europe
  AL: 'Europe/Tirane', AD: 'Europe/Andorra', AT: 'Europe/Vienna', BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',  CH: 'Europe/Zurich',  CY: 'Asia/Nicosia',  CZ: 'Europe/Prague',
  DE: 'Europe/Berlin', DK: 'Europe/Copenhagen', EE: 'Europe/Tallinn', ES: 'Europe/Madrid',
  FI: 'Europe/Helsinki', FR: 'Europe/Paris',  GB: 'Europe/London',  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',  HU: 'Europe/Budapest', IE: 'Europe/Dublin',  IS: 'Atlantic/Reykjavik',
  IT: 'Europe/Rome',    LT: 'Europe/Vilnius',  LU: 'Europe/Luxembourg', LV: 'Europe/Riga',
  MT: 'Europe/Malta',   NL: 'Europe/Amsterdam', NO: 'Europe/Oslo',   PL: 'Europe/Warsaw',
  PT: 'Europe/Lisbon',  RO: 'Europe/Bucharest', RS: 'Europe/Belgrade', SE: 'Europe/Stockholm',
  SI: 'Europe/Ljubljana', SK: 'Europe/Bratislava', UA: 'Europe/Kyiv',
  // Americas
  AR: 'America/Argentina/Buenos_Aires', BO: 'America/La_Paz',  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',  CL: 'America/Santiago',  CO: 'America/Bogota',
  MX: 'America/Mexico_City', PE: 'America/Lima',   UY: 'America/Montevideo',
  US: 'America/New_York',
  // Africa
  DZ: 'Africa/Algiers',  EG: 'Africa/Cairo',   ET: 'Africa/Addis_Ababa',
  GH: 'Africa/Accra',    KE: 'Africa/Nairobi', MA: 'Africa/Casablanca',
  NG: 'Africa/Lagos',    ZA: 'Africa/Johannesburg', TN: 'Africa/Tunis',
  // Middle East / Asia
  AE: 'Asia/Dubai',  AM: 'Asia/Yerevan',  AZ: 'Asia/Baku',   BH: 'Asia/Bahrain',
  BD: 'Asia/Dhaka',  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', IN: 'Asia/Kolkata',
  ID: 'Asia/Jakarta', IL: 'Asia/Jerusalem', IQ: 'Asia/Baghdad', IR: 'Asia/Tehran',
  JP: 'Asia/Tokyo',   JO: 'Asia/Amman',    KR: 'Asia/Seoul',   KW: 'Asia/Kuwait',
  KZ: 'Asia/Almaty',  LB: 'Asia/Beirut',   MY: 'Asia/Kuala_Lumpur', NP: 'Asia/Kathmandu',
  OM: 'Asia/Muscat',  PH: 'Asia/Manila',   PK: 'Asia/Karachi', QA: 'Asia/Qatar',
  RU: 'Europe/Moscow', SA: 'Asia/Riyadh',  SG: 'Asia/Singapore', TH: 'Asia/Bangkok',
  TR: 'Europe/Istanbul', TW: 'Asia/Taipei', VN: 'Asia/Ho_Chi_Minh',
  // Oceania
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland'
};

// Format today's date as YYYY-MM-DD in a specific timeZone
function todayInTZ(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default async function handler(req, res) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();

    // Load totals to know which ISO2 codes we support
    const totalsPath = path.join(process.cwd(), 'public', 'data', `totals-${year}.json`);
    const totals = JSON.parse(fs.readFileSync(totalsPath, 'utf8')).totals || {};
    const iso2List = Object.keys(totals);

    // Base URL to call your own API from the server (works on Vercel)
    // If you have issues locally, you can use an absolute URL or read direct data instead.
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
      '';

    const results = await Promise.allSettled(
      iso2List.map(async (iso2) => {
        const tz = COUNTRY_TZ[iso2] || 'UTC';
        const todayStr = todayInTZ(tz);
        const url = `${base}/api/holidayDetails?iso2=${iso2}&year=${year}`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return null;
        const data = await r.json();
        const holidays = Array.isArray(data.holidays) ? data.holidays : [];
        const national = holidays.filter(h => h && h.global === true);
        const isToday = national.some(h => h.date === todayStr);
        return isToday ? iso2 : null;
      })
    );

    const today = results
      .map(r => (r.status === 'fulfilled' ? r.value : null))
      .filter(Boolean);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ today });
  } catch (err) {
    // Fail-safe: return empty set so the client still renders
    res.status(200).json({ today: [] });
  }
}
