// Returns the top 20 calendar dates with the most holidays for a given year.
// Tries (in order):
// 1) public/data/top-days-<YEAR>.json           (prebuilt)
// 2) public/data/holidays-by-date-<YEAR>.json   (map: "YYYY-MM-DD" -> [{iso2, country, name}, ...])
// 3) public/data/countries/<ISO2>/<YEAR>.json   (array: {date, name, country?, iso2?})
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
    const prebuiltPath = path.join(dataDir, `top-days-${YEAR}.json`);
    const byDatePath = path.join(dataDir, `holidays-by-date-${YEAR}.json`);
    const countriesDir = path.join(dataDir, "countries");

    // 1) Serve prebuilt if present
    if (fs.existsSync(prebuiltPath)) {
      const raw = fs.readFileSync(prebuiltPath, "utf-8");
      res.setHeader(
        "Cache-Control",
        "public, max-age=3600, stale-while-revalidate=300"
      );
      return res.status(200).json(JSON.parse(raw));
    }

    // --- Build from sources ---
    let byDate = {};

    // 2) by-date map
    if (fs.existsSync(byDatePath)) {
      byDate = JSON.parse(fs.readFileSync(byDatePath, "utf-8"));
    } else if (fs.existsSync(countriesDir)) {
      // 3) per-country fallback
      const iso2s = fs
        .readdirSync(countriesDir)
        .filter((f) => fs.statSync(path.join(countriesDir, f)).isDirectory());

      for (const iso2 of iso2s) {
        const p = path.join(countriesDir, iso2, `${YEAR}.json`);
        if (!fs.existsSync(p)) continue;

        let arr = [];
        try {
          arr = JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {
          arr = [];
        }

        for (const h of arr) {
          const date = h.date || h.isoDate || h.on || h.d || null;
          if (!date) continue;
          const item = {
            iso2,
            country: h.country || h.countryName || iso2,
            name: h.name || h.title || "Holiday",
          };
          (byDate[date] ||= []).push(item);
        }
      }
    } else {
      res.setHeader("Cache-Control", "no-store");
      return res
        .status(501)
        .json({ error: "No data source found under public/data." });
    }

    // Aggregate + sort
    const rows = Object.entries(byDate).map(([date, items]) => ({
      date,
      count: items.length,
      items: items.map((x) => ({
        iso2: x.iso2,
        country: x.country,
        name: x.name,
      })),
    }));

    rows.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
    const top = rows.slice(0, 20);

    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=300"
    );
    return res.status(200).json({ year: YEAR, top });
  } catch (err) {
    console.error("top-days error", err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "Internal error computing top days" });
  }
}
