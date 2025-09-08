// /public/busiest-days.js — ultra-simple: GROUP BY date + COUNT (from window.TOTALS)
(function () {
  // ---- tiny helpers
  const $ = (sel) => document.querySelector(sel);
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) =>
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
    );
    return n;
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

  // ---- pickers that tolerate different shapes
  const pad = (n) => String(n).padStart(2, "0");
  function pickDate(h, yearFallback) {
    if (!h) return null;
    if (typeof h.date === "string") return h.date;               // "2025-01-01"
    if (h.isoDate) return h.isoDate;                              // "2025-01-01"
    if (h.on) return h.on;
    if (h.d) return h.d;
    if (h.date && typeof h.date === "object" && typeof h.date.iso === "string") return h.date.iso;
    if (Number.isInteger(h.month) && Number.isInteger(h.day)) {
      const y = Number(h.year) || yearFallback || new Date().getFullYear();
      return `${y}-${pad(h.month)}-${pad(h.day)}`;
    }
    return null;
  }
  const pickName = (h) => h?.name || h?.title || h?.localName || "Holiday";

  function getYear() {
    const txt = $("#details-title")?.textContent || "";
    const m = txt.match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : new Date().getFullYear();
  }

  // ---- CORE: group by date + count (from window.TOTALS)
  function computeTop20FromTOTALS(YEAR) {
    const totals = (typeof window !== "undefined" && window.TOTALS) || null;
    if (!totals || typeof totals !== "object") {
      throw new Error("TOTALS not loaded on window. Ensure your page defines window.TOTALS before this script.");
    }

    // byDate: date -> { count, items: [{iso2,country,name}] }
    const byDate = Object.create(null);

    // totals can be an object { CA:{name,holidays:[...]}, ... }
    // or an array; normalize to entries
    const entries = Array.isArray(totals)
      ? totals
      : Object.entries(totals).map(([iso2, rec]) => ({ iso2, ...rec }));

    for (const rec of entries) {
      const iso2 = rec.iso2 || rec.code || rec.countryCode || rec.id;
      const country = rec.country || rec.countryName || rec.name || iso2;
      const list = rec.holidays || rec.days || rec.entries || rec.items || rec.list || [];

      for (const h of list) {
        const date = pickDate(h, YEAR);
        if (!date) continue;

        // If your dataset contains regional flags and you want national-only, keep this:
        // if (h.type === "Regional" || h.regional === true) continue;

        const item = { iso2, country, name: pickName(h) };
        (byDate[date] ||= { date, count: 0, items: [] });
        byDate[date].count += 1;
        byDate[date].items.push(item);
      }
    }

    const rows = Object.values(byDate);
    rows.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
    return rows.slice(0, 20);
  }

  // ---- rendering (modal stays the same)
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

  function openModal(year, evt) {
    if (evt) { evt.preventDefault(); evt.stopPropagation(); }

    const root = document.getElementById("busiest-days-root");
    if (!root) return;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    clear(root);

    const overlay = el("div", { class: "bdst-overlay", onclick: () => closeModal() });
    const dialog  = el("div", { class: "bdst-dialog" });
    const panel   = el("div", { class: "bdst-panel", role: "dialog", "aria-modal": "true", "aria-label": "Busiest days" });

    const title   = el("div", { class: "bdst-title" }, `Top 20 busiest holiday dates — ${year}`);
    const dlBtn   = el("a", { class: "bdst-btn", id: "bdst-dl", href: "javascript:void(0)" }, "Download CSV");
    dlBtn.style.display = "none";
    const closeBtn= el("button", { class: "bdst-btn", onclick: () => closeModal() }, "Close");
    const header  = el("div", { class: "bdst-header" }, [title, el("div", { class: "bdst-actions" }, [dlBtn, closeBtn])]);

    const body    = el("div", { class: "bdst-body" });
    const scroll  = el("div", { class: "bdst-scroll" }, el("p", { class: "bdst-muted", id: "bdst-status", text: "Loading…" }));
    body.appendChild(scroll);

    panel.appendChild(header);
    panel.appendChild(body);
    dialog.appendChild(panel);
    root.appendChild(overlay);
    root.appendChild(dialog);

    // Compute locally (GROUP BY date + COUNT)
    let rows = [];
    try {
      rows = computeTop20FromTOTALS(year);
    } catch (err) {
      clear(scroll);
      scroll.appendChild(el("p", { class: "bdst-error", text: String(err?.message || err) }));
      return;
    }

    clear(scroll);
    if (!rows.length) {
      scroll.appendChild(el("p", { class: "bdst-muted", text: `No data found for ${year}.` }));
      return;
    }
    scroll.appendChild(renderTable(rows));

    // CSV
    const csv  = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    dlBtn.href = url;
    dlBtn.setAttribute("download", `top-days-${year}.csv`);
    dlBtn.style.display = "";
  }

  function closeModal() {
    const root = document.getElementById("busiest-days-root");
    if (!root) return;
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    clear(root);
  }

  // Wire the button (and block any parent tab handler)
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-busiest-days");
    if (!btn) return;
    btn.addEventListener("click", (e) => openModal(getYear(), e), { capture: true });
  });
})();
