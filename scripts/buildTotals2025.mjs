// scripts/buildTotals2025.mjs
// Build 2025 totals from Nager.Date.
// - NATIONAL: prefer Nager Countries table number; fallback to API (unique dates with global:true).
// - REGIONAL: from API (unique dates with global:false and counties present).
// - Per-region breakdown: unique dates per ISO-3166-2 code.
// Output: public/data/totals-2025.json

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

// --- Robustly parse https://date.nager.at/Country ---
// Returns a map: { "FR": 11, "VE": 11, ... }
async function getBaselineNationalCounts() {
  const html = await fetchText("https://date.nager.at/Country");

  // Split by table rows, then extract the first three <td> values (name, code, count)
  const rows = html.split(/<tr[\s>]/i).slice(1); // skip header split chunk
  const map = {};

  for (const row of rows) {
    const tds = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gis)].map(m =>
      m[1].replace(/<[^>]*>/g, "").trim() // strip nested tags, keep text
    );
    if (tds.length < 3) continue;

    const code = (tds[1] || "").toUpperCase().replace(/[^A-Z]/g, "");
    const num  = parseInt(tds[2], 10);
    if (/^[A-Z]{2}$/.test(code) && Number.isInteger(num)) {
      map[code] = num;
    }
  }

  return map;
}

// Unique-date national count from the API (fallback)
function nationalFromAPI(rows) {
  const publicRows = (Array.isArray(rows) ? rows : []).filter(h => {
    const types = Array.isArray(h?.types) ? h.types : ["Public"];
    return types.some(t => /public/i.test(String(t)));
  });
  const dates = new Set(publicRows.filter(h => h?.global === true).map(h => h.date));
  return dates.size;
}

function regionalFromAPI(rows) {
  const publicRows = (Array.isArray(rows) ? rows : []).filter(h => {
    const types = Array.isArray(h?.types) ? h.types : ["Public"];
    return types.some(t => /public/i.test(String(t)));
  });

  // Unique regional dates across the country
  const regionalDates = new Set(
    publicRows
      .filter(h => h?.global === false && Array.isArray(h.counties) && h.counties.length)
      .map(h => h.date)
  );

  // Unique dates per region code
  const perRegionSets = {};
  for (const h of publicRows) {
    if (h?.global === false && Array.isArray(h.counties)) {
      for (const c of h.counties) {
        const code = String(c).toUpperCase();
        (perRegionSets[code] ||= new Set()).add(h.date);
      }
    }
  }
  const perRegionCounts = Object.fromEntries(
    Object.entries(perRegionSets).map(([k, s]) => [k, s.size])
  );

  return { regionalCount: regionalDates.size, perRegionCounts };
}

async function main() {
  const baseline = await getBaselineNationalCounts(); // what the site shows
  const countries = await fetchJSON("https://date.nager.at/api/v3/AvailableCountries"); // [{countryCode,name}]

  const totals  = {};
  const regions = {};
  const fellBack = []; // codes where we used API fallback for national

  for (const { countryCode, name } of countries) {
    const code = String(countryCode).toUpperCase();

    let nat = baseline[code]; // prefer baseline
    let reg = null;
    let perRegion = {};

    try {
      const rows = await fetchJSON(`https://date.nager.at/api/v3/PublicHolidays/${YEAR}/${code}`);

      if (!Number.isInteger(nat)) {
        nat = nationalFromAPI(rows);
        fellBack.push(code);
      }

      const { regionalCount, perRegionCounts } = regionalFromAPI(rows);
      reg = regionalCount;
      perRegion = perRegionCounts;
    } catch {
      // If the API hiccups, keep national as baseline (if present), and leave regional null.
      if (!Number.isInteger(nat)) nat = null;
      reg = null;
      perRegion = {};
    }

    totals[code]  = { name, national: nat, regional: reg };
    regions[code] = perRegion;
  }

  if (fellBack.length) {
    console.log(`Baseline missing for (used API fallback): ${fellBack.join(", ")}`);
  }

  const out = { year: YEAR, updatedAt: new Date().toISOString(), totals, regions };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
