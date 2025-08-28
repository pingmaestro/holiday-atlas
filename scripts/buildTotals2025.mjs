// scripts/buildTotals2025.mjs
// Build static totals for 2025 from Nager.Date (free).
// Output: public/data/totals-2025.json  -> { year, updatedAt, totals: { "CA": {name, count}, ... } }

import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const YEAR = 2025;
const OUT = path.resolve("public/data/totals-2025.json");

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  const COUNTRIES_URL = "https://date.nager.at/api/v3/AvailableCountries";
  const HOLIDAYS_URL = (code) => `https://date.nager.at/api/v3/PublicHolidays/${YEAR}/${code}`;

  const countries = await fetchJSON(COUNTRIES_URL); // [{countryCode, name}, ...]
  const totals = {};
  let done = 0;

  for (const { countryCode, name } of countries) {
    try {
      const arr = await fetchJSON(HOLIDAYS_URL(countryCode)); // [{date,name,localName,types,...}]
      totals[countryCode.toUpperCase()] = { name, count: Array.isArray(arr) ? arr.length : 0 };
    } catch {
      totals[countryCode.toUpperCase()] = { name, count: null };
    }
    done++;
    if (done % 25 === 0) console.log(`Fetched ${done}/${countries.length}`);
    // politeness pacing
    await sleep(60);
  }

  const out = { year: YEAR, updatedAt: new Date().toISOString(), totals };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
