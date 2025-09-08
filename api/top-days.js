// /api/top-days.js
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const yParam = Number(url.searchParams.get("year"));
    const YEAR =
      Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
        ? yParam
        : new Date().getFullYear();

    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;

    const dataDir = path.join(process.cwd(), "public", "data");
    const prebuiltPath   = path.join(dataDir, `top-days-${YEAR}.json`);
    const byDatePath     = path.join(dataDir, `holidays-by-date-${YEAR}.json`);
    const totalsPath     = path.join(dataDir, `totals-${YEAR}.json`);
    const countriesDir   = path.join(dataDir, "countries");

    // 1) Serve prebuilt if present
    if (fs.existsSync(prebuiltPath)) {
      const raw = fs.readFileSync(prebuiltPath, "utf-8");
      res.setHeader("Cache-Control","public, max-age=3600, stale-while-revalidate=300");
      return res.status(200).json(JSON.parse(raw));
    }

    // Helper: push item into byDate map
    const byDate = {};
    const add = (date, item) => {
      if (!date) return;
      (byDate[date] ||= []).push(item);
    };
    const pad = (n) => String(n).padStart(2, "0");
    const pickDate = (h) => {
      if (!h) return null;
      if (typeof h.date === "string") return h.date;                         // "2025-01-01"
      if (h.isoDate) return h.isoDate;                                       // "2025-01-01"
      if (h.on) return h.on;
      if (h.d) return h.d;
      if (h.date && typeof h.date === "object" && typeof h.date.iso === "string") return h.date.iso; // {date:{iso:"2025-..."}}
      if (Number.isInteger(h.month) && Number.isInteger(h.day))
        return `${YEAR}-${pad(h.month)}-${pad(h.day)}`;
      return null;
    };
    const pickName = (h) => h?.name || h?.title || h?.localName || "Holiday";

    // 2) by-date map
    if (fs.existsSync(byDatePath)) {
      const byDateJson = JSON.parse(fs.readFileSync(byDatePath, "utf-8"));
      for (const [date, items] of Object.entries(byDateJson)) {
        for (const x of items || []) {
          add(date, {
            iso2: x.iso2 || x.code || x.countryCode,
            country: x.country || x.countryName || x.name || x.iso2,
            name: x.name || x.title || "Holiday",
          });
        }
      }
    }
    // 3) totals-<YEAR>.json (new)
    else if (fs.existsSync(totalsPath)) {
      const totals = JSON.parse(fs.readFileSync(totalsPath, "utf-8"));
      // Accept either object { CA:{name:'Canada', holidays:[...]}, ... } or array
      const entries = Array.isArray(totals)
        ? totals
        : Object.entries(totals).map(([iso2, rec]) => ({ iso2, ...rec }));

      for (const rec of entries) {
        const iso2 = rec.iso2 || rec.code || rec.countryCode || rec.id;
        const countryName = rec.country || rec.countryName || rec.name || iso2;
        const list =
          rec.holidays || rec.days || rec.entries || rec.items || rec.list || [];
        for (const h of list) {
          const date = pickDate(h);
          add(date, { iso2, country: countryName, name: pickName(h) });
        }
      }
    }
    // 4) per-country fallback under /countries/<ISO2>/<YEAR>.json
    else if (fs.existsSync(countriesDir)) {
      const iso2s = fs
        .readdirSync(countriesDir)
        .filter((f) => fs.statSync(path.join(countriesDir, f)).isDirectory());
      for (const iso2 of iso2s) {
        const p = path.join(countriesDir, iso2, `${YEAR}.json`);
        if (!fs.existsSync(p)) continue;
        let arr = [];
        try { arr = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { arr = []; }
        for (const h of arr) {
          const date = pickDate(h);
          add(date, {
            iso2,
            country: h.country || h.countryName || iso2,
            name: pickName(h),
          });
        }
      }
    } else {
      // nothing found
      res.setHeader("Cache-Control", "no-store");
      return res.status(501).json({ error: "No data source found under public/data." });
    }

    // Aggregate + sort
    const rows = Object.entries(byDate).map(([date, items]) => ({
      date,
      count: items.length,
      items,
    }));
    rows.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
    const top = rows.slice(0, 20);

    res.setHeader("Cache-Control","public, max-age=3600, stale-while-revalidate=300");
    return res.status(200).json({ year: YEAR, top });
  } catch (err) {
    console.error("top-days error", err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Internal error computing top days" });
  }
}
