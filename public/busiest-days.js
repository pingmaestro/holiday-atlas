// /public/busiest-days.js  — client-only aggregator (no API required)
(function () {
  // ---------- tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c =>
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
    );
    return node;
  };
  const weekdayUTC = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "long" });
  };
  const toCSV = (rows) => {
    const header = ["rank","count","date","countries","holidays"];
    const out = [header.join(",")];
    rows.forEach((r, i) => {
      const countries = r.items.map(x => x.iso2 || x.country).join(" | ");
      const names = r.items.map(x => `${x.country || x.iso2}: ${x.name}`).join(" | ");
      out.push([i+1, r.count, r.date, JSON.stringify(countries), JSON.stringify(names)].join(","));
    });
    return out.join("\n");
  };

  // ---------- year detection ----------
  function getYear() {
    const btnYear = Number($("#btn-busiest-days")?.dataset?.year);
    if (Number.isInteger(btnYear)) return btnYear;
    const m = ($("#details-title")?.textContent || "").match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : new Date().getFullYear();
  }

  // ---------- loaders (client-side) ----------
  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  // Try totals-YYYY.json first (likely what you already have)
  async function loadFromTotals(year) {
    const data = await fetchJson(`/data/totals-${year}.json`);
    const entries = Array.isArray(data)
      ? data
      : Object.entries(data).map(([iso2, rec]) => ({ iso2, ...rec }));

    const byDate = {};
    const pad = (n) => String(n).padStart(2, "0");
    const pickDate = (h) => {
      if (!h) return null;
      if (typeof h.date === "string") return h.date;
      if (h.isoDate) return h.isoDate;
      if (h.on) return h.on;
      if (h.d) return h.d;
      if (h.date && typeof h.date === "object" && typeof h.date.iso === "string") return h.date.iso;
      if (Number.isInteger(h.month) && Number.isInteger(h.day)) return `${year}-${pad(h.month)}-${pad(h.day)}`;
      return null;
    };
    const pickName = (h) => h?.name || h?.title || h?.localName || "Holiday";

    for (const rec of entries) {
      const iso2 = rec.iso2 || rec.code || rec.countryCode || rec.id;
      const country = rec.country || rec.countryName || rec.name || iso2;
      const list = rec.holidays || rec.days || rec.entries || rec.items || rec.list || [];
      for (const h of list) {
        const date = pickDate(h);
        if (!date) continue;
        (byDate[date] ||= []).push({ iso2, country, name: pickName(h) });
      }
    }
    return byDate;
  }

  async function loadByDate(year) {
    return fetchJson(`/data/holidays-by-date-${year}.json`);
  }

  async function loadFallbackCountries(year) {
    // Optional: only if you’ve populated /data/countries/<ISO2>/<YEAR>.json
    const idx = await fetchJson(`/data/countries/index.json`).catch(() => null);
    if (!idx) return {};
    const byDate = {};
    const pad = (n) => String(n).padStart(2, "0");
    const pickDate = (h) => {
      if (!h) return null;
      if (typeof h.date === "string") return h.date;
      if (h.isoDate) return h.isoDate;
      if (h.on) return h.on;
      if (h.d) return h.d;
      if (h.date && typeof h.date === "object" && typeof h.date.iso === "string") return h.date.iso;
      if (Number.isInteger(h.month) && Number.isInteger(h.day)) return `${year}-${pad(h.month)}-${pad(h.day)}`;
      return null;
    };
    const pickName = (h) => h?.name || h?.title || h?.localName || "Holiday";

    for (const iso2 of idx.iso2 || []) {
      const arr = await fetchJson(`/data/countries/${iso2}/${year}.json`).catch(() => null);
      if (!arr) continue;
      for (const h of arr) {
        const date = pickDate(h);
        if (!date) continue;
        (byDate[date] ||= []).push({ iso2, country: h.country || h.countryName || iso2, name: pickName(h) });
      }
    }
    return byDate;
  }

  async function loadByAnySource(year) {
    // Order: totals -> by-date -> per-country fallback
    try { return await loadFromTotals(year); } catch {}
    try { return await loadByDate(year); } catch {}
    try { return await loadFallbackCountries(year); } catch {}
    throw new Error("No data source found under /public/data");
  }

  // ---------- aggregation ----------
  function toTop20(byDate) {
    const rows = Object.entries(byDate).map(([date, items]) => ({
      date,
      count: items.length,
      items
    }));
    rows.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
    return rows.slice(0, 20);
  }

  // ---------- rendering ----------
  function renderTable(rows) {
    const thead = el("thead", {}, [
      el("tr", {}, [
        el("th", {}, " # "),
        el("th", {}, "Holidays"),
        el("th", {}, "Date"),
        el("th", {}, "Countries"),
        el("th", {}, "Holiday names"),
      ]),
    ]);

    const tbody = el("tbody");
    rows.forEach((r, idx) => {
      const countries = el("td", {}, [
        el("div", {}, r.items.map(x => el("span", { class: "bdst-badge bdst-mono", text: x.iso2 || x.country })))
      ]);
      const names = el("td", {}, el(
        "ul",
        { class: "bdst-list" },
        r.items.map(x => el("li", {}, [el("strong", {}, x.country || x.iso2), document.createTextNode(`: ${x.name}`)]))
      ));
      const tr = el("tr", {}, [
        el("td", { class: "bdst-center bdst-mono" }, String(idx + 1)),
        el("td", { class: "bdst-center bdst-mono" }, String(r.count)),
        el("td", {}, `${r.date} (${weekdayUTC(r.date)})`),
        countries,
        names
      ]);
      tbody.appendChild(tr);
    });

    return el("table", { class: "bdst-table" }, [thead, tbody]);
  }

  function openModal(year) {
    const root = document.getElementById("busiest-days-root");
    if (!root) return;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    clear(root);

    const overlay = el("div", { class: "bdst-overlay", onclick: () => closeModal() });
    const dialog = el("div", { class: "bdst-dialog" });
    const panel  = el("div", { class: "bdst-panel", role: "dialog", "aria-modal": "true", "aria-label": "Busiest days" });

    // header
    const title   = el("div", { class: "bdst-title" }, `Top 20 busiest holiday dates — ${year}`);
    const dlBtn   = el("a", { class: "bdst-btn", id: "bdst-dl", href: "javascript:void(0)" }, "Download CSV");
    dlBtn.style.display = "none"; // hidden until data is ready
    const closeBtn= el("button", { class: "bdst-btn", onclick: () => closeModal() }, "Close");
    const header  = el("div", { class: "bdst-header" }, [title, el("div", { class: "bdst-actions" }, [dlBtn, closeBtn])]);

    // body
    const body   = el("div", { class: "bdst-body" });
    const scroll = el("div", { class: "bdst-scroll" }, el("p", { class: "bdst-muted", id: "bdst-status", text: "Loading…" }));
    body.appendChild(scroll);

    panel.appendChild(header);
    panel.appendChild(body);
    dialog.appendChild(panel);
    root.appendChild(overlay);
    root.appendChild(dialog);

    // load + render
    loadByAnySource(year)
      .then((byDate) => {
        clear(scroll);
        const rows = toTop20(byDate);
        if (!rows.length) {
          scroll.appendChild(el("p", { class: "bdst-muted", text: `No data found for ${year}.` }));
          return;
        }
        scroll.appendChild(renderTable(rows));

        // enable CSV
        const csv = toCSV(rows);
        const blob = new Blob([csv], { type: "text/csv" });
        const url  = URL.createObjectURL(blob);
        dlBtn.href = url;
        dlBtn.setAttribute("download", `top-days-${year}.csv`);
        dlBtn.style.display = "";
      })
      .catch((err) => {
        clear(scroll);
        scroll.appendChild(el("p", { class: "bdst-error", text: String(err?.message || err) }));
      });
  }

  function closeModal() {
    const root = document.getElementById("busiest-days-root");
    if (!root) return;
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    clear(root);
  }

  // wire
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-busiest-days");
    if (!btn) return;
    btn.addEventListener("click", () => openModal(getYear()));
  });
})();
