// scripts/buildTotals2025.mjs
// National counts = Nager "Countries" table (stable, what users expect)
// Regional counts = from 2025 PublicHolidays (unique dates per region)
// Output: public/data/totals-2025.json  -> { year, updatedAt, totals, regions }

import fs from "node:fs/promises";
import path from "node:path";

const YEAR = 2025;
const OUT  = path.resolve("public/data/totals-2025.json");

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Parse https://date.nager.at/Country table into { US:10, FR:11, VE:11, ... }
async function getBaselineNationalCounts() {
  const html = await fetchText("https://date.nager.at/Country");
  const map = {};
  // crude but effective: rows like "<td>Venezuela</td><td>VE</td><td>11</td>"
  const rowRe = /<tr>\s*<td>(.*?)<\/td>\s*<td>([A-Z]{2})<\/td>\s*<td>(\d+)<\/td>/g;
  for (const m of html.matchAll(rowRe)) {
    const code = m[2].toUpperCase();
    const num = parseInt(m[3], 10);
    map[code] = num;
  }
  if (!map.FR || !map.VE) throw new Error("Failed to parse baseline table");
  return map;
}

async function main() {
  const baseline = await getBaselineNationalCounts(); // official counts
  const countries = await fetchJSON("https://date.nager.at/api/v3/AvailableCountries"); // [{countryCode,name}]
  const totals  = {};
  const regions = {};

  for (const { countryCode, name } of countries) {
    const code = countryCode.toUpperCase();
    // default to baseline national (so map aligns with Nager site)
    const baselineNational = baseline[code] ?? null;

    // Build regional stats from 2025 feed
    let regionalCount = null;
    let perRegion = {};
    try {
      const arr = await fetchJSON(`https://date.nager.at/api/v3/PublicHolidays/${YEAR}/${code}`);
      const rows = Array.isArray(arr) ? arr : [];

      // regional = unique dates where counties exist and global === false
      const regionalDates = new Set(
        rows
          .filter(h => h?.global === false && Array.isArray(h.counties) && h.counties.length)
          .map(h => h.date)
      );

      // per-region = unique dates per ISO-3166-2 code
      const perRegionSets = {};
      for (const h of rows) {
        if (h?.global === false && Array.isArray(h.counties)) {
          for (const c of h.counties) {
            (perRegionSets[String(c).toUpperCase()] ||= new Set()).add(h.date);
          }
        }
      }
      perRegion = Object.fromEntries(
        Object.entries(perRegionSets).map(([k, s]) => [k, s.size])
      );
      regionalCount = regionalDates.size;
    } catch {
      regionalCount = null;
      perRegion = {};
    }

    totals[code]  = { name, national: baselineNational, regional: regionalCount };
    regions[code] = perRegion;
  }

  const out = { year: YEAR, updatedAt: new Date().toISOString(), totals, regions };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
