// /public/busiest-days.js
(function () {
  // ---------- utils ----------
  function $(sel) { return document.querySelector(sel); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function weekdayUTC(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { weekday: "long" });
  }

  function getYear() {
    // 1) data-year on the button
    const btn = $("#btn-busiest-days");
    const btnYear = Number(btn?.dataset?.year);
    if (Number.isInteger(btnYear) && btnYear >= 1900 && btnYear <= 2100) return btnYear;

    // 2) <meta name="holiday-atlas-year" content="2025">
    const meta = document.querySelector('meta[name="holiday-atlas-year"]');
    const metaYear = Number(meta?.content);
    if (Number.isInteger(metaYear) && metaYear >= 1900 && metaYear <= 2100) return metaYear;

    // 3) #details-title like "Holidays (2025)"
    const t = $("#details-title")?.textContent || "";
    const m = t.match(/\b(19|20)\d{2}\b/);
    if (m) return Number(m[0]);

    // 4) fallback
    return new Date().getFullYear();
  }

  function toCSV(rows) {
    const header = ["rank", "count", "date", "countries", "holidays"];
    const out = [header.join(",")];
    rows.forEach((r, i) => {
      const countries = r.items.map((x) => x.iso2 || x.country).join(" | ");
      const names = r.items.map((x) => `${x.country || x.iso2}: ${x.name}`).join(" | ");
      out.push([i + 1, r.count, r.date, JSON.stringify(countries), JSON.stringify(names)].join(","));
    });
    return out.join("\n");
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
        el(
          "div",
          {},
          r.items.map((x) => el("span", { class: "bdst-badge bdst-mono", text: x.iso2 || x.country }))
        ),
      ]);

      const names = el(
        "td",
        {},
        el(
          "ul",
          { class: "bdst-list" },
          r.items.map((x) =>
            el("li", {}, [el("strong", {}, x.country || x.iso2), document.createTextNode(`: ${x.name}`)])
          )
        )
      );

      const tr = el("tr", {}, [
        el("td", { class: "bdst-center bdst-mono" }, String(idx + 1)),
        el("td", { class: "bdst-center bdst-mono" }, String(r.count)),
        el("td", {}, `${r.date} (${weekdayUTC(r.date)})`),
        countries,
        names,
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
    const panel = el("div", {
      class: "bdst-panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Busiest days",
    });

    const title = el("div", { class: "bdst-title" }, `Top 20 busiest holiday dates — ${year}`);
    const closeBtn = el("button", { class: "bdst-btn", onclick: () => closeModal() }, "Close");
    const dlBtn = el("a", { class: "bdst-btn", id: "bdst-dl", href: "#", download: `top-days-${year}.csv` }, "Download CSV");
    const header = el("div", { class: "bdst-header" }, [title, el("div", { class: "bdst-actions" }, [dlBtn, closeBtn])]);

    const body = el("div", { class: "bdst-body" });
    const scroll = el("div", { class: "bdst-scroll" });
    const status = el("p", { class: "bdst-muted", id: "bdst-status" }, "Loading…");
    scroll.appendChild(status);
    body.appendChild(scroll);

    panel.appendChild(header);
    panel.appendChild(body);
    dialog.appendChild(panel);
    root.appendChild(overlay);
    root.appendChild(dialog);

    // Fetch data
    fetch(`/api/top-days?year=${year}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        clear(scroll);
        if (!ok) {
          scroll.appendChild(el("p", { class: "bdst-error" }, j?.error || "Failed to load"));
          return;
        }
        const rows = j?.top || [];
        if (!rows.length) {
          scroll.appendChild(el("p", { class: "bdst-muted" }, `No data found for ${year}.`));
          return;
        }
        scroll.appendChild(renderTable(rows));

        // CSV
        const csv = toCSV(rows);
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.getElementById("bdst-dl");
        a.setAttribute("href", url);
        a.setAttribute("download", `top-days-${year}.csv`);
      })
      .catch((err) => {
        clear(scroll);
        scroll.appendChild(el("p", { class: "bdst-error" }, String(err?.message || err)));
      });
  }

  function closeModal() {
    const root = document.getElementById("busiest-days-root");
    if (!root) return;
    root.setAttribute("aria-hidden", "true");
    root.hidden = true;
    clear(root);
  }

  // ---------- wire up ----------
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-busiest-days");
    if (!btn) return;
    btn.addEventListener("click", () => openModal(getYear()));
  });
})();
