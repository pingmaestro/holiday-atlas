// Holiday Atlas app.js — YEAR views + List/Calendar (national-only) + Long Weekend tags/overlay + chip→map hover

import { normalizeCodeList } from '/utils/country-codes.js';
import { mountMostTable } from './most-table.js';

(async function () {
  // ---- Dynamic YEAR with optional ?year= override ----
  const yParam = Number(new URLSearchParams(location.search).get('year'));
  const YEAR = Number.isInteger(yParam) && yParam >= 1900 && yParam <= 2100
    ? yParam
    : new Date().getFullYear();

  // ---- Tiny HTML escaper ----
  const esc = s => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  // ---- Parse ISO (YYYY-MM-DD) as local Date (avoid UTC off-by-one) ----
  function parseLocalISODate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
      ? new Date(y, m - 1, d)
      : new Date(iso);
  }

  // ---- State ----
  let TOTALS = {};   // { FR:{ name, national, regional }, ... }
  let REGIONS = {};  // { FR:{ 'FR-75': n, ... }, ... }
  const detailsCache = new Map();      // key: "FR-2025" -> holidays[]
  const longWeekendCache = new Map();  // key: "FR-2025" -> { list, dateSet }
  let CURRENT_VIEW = 'all';            // 'all' | 'today' | 'range'
  let CURRENT_MODE = 'list';           // 'list' or 'cal' (only used in All Year)
  let CURRENT_DETAILS = null;          // { iso2, displayName, holidays, regionCode }
  let TODAY_PRETTY_DATE = '';

  // All-Year selection via per-point color
  let SELECTED_KEY = null;     // 'CA', 'FR', ...
  let SELECTED_POINT = null;   // Highcharts point

  // Tooltip sources for non-All-Year views
  let TODAY_ITEMS_MAP = new Map(); // ISO2 -> [holiday names today]
  let RANGE_ITEMS_MAP = new Map(); // ISO2 -> [{date,name}, ...]

  // All-Year: stable national counts precomputed from /api/holidayDetails
  let NAT_COUNTS = new Map();  // ISO2 -> number
  let COUNTS_READY = false;

  // ---- Elements ----
  const detailsTitle  = document.getElementById('details-title');
  const detailsBody   = document.getElementById('details-body');
  const loadingEl     = document.getElementById('view-loading');
  const detailsTabsEl = document.querySelector('.details-views'); // List/Calendar pills

  setDetailsPanelVisible(false);
  showDetailsTabs(false);

  function setDetailsPanelVisible(show) {
    const panel = detailsBody?.closest('.card') || detailsBody?.parentElement;
    if (panel) panel.hidden = !show;
    if (detailsTitle)  detailsTitle.hidden = !show;
    if (detailsTabsEl) detailsTabsEl.hidden = !show;
    const regionList = document.getElementById('region-list');
    if (regionList) regionList.hidden = !show;
  }
  const showDetailsTabs = (show) => { if (detailsTabsEl) detailsTabsEl.hidden = !show; };

  // ---- Country list helpers (can see TOTALS after load) ----
  function countryNameFromISO2(iso2) {
    const rec = (TOTALS && TOTALS[iso2]) || null;
    return rec?.name || iso2;
  }
  function flagFromISO2(iso2) {
    if (!iso2 || iso2.length !== 2) return "🌐";
    const A = 0x1F1E6, a = "A".charCodeAt(0), u = iso2.toUpperCase();
    return String.fromCodePoint(A + (u.charCodeAt(0) - a), A + (u.charCodeAt(1) - a));
  }
  function renderCountryPanel(viewLabel, iso2List) {
    const mount = document.getElementById("holiday-country-list");
    if (!mount) return;

    const list = Array.from(new Set(iso2List || [])).filter(Boolean)
      .sort((a,b)=>countryNameFromISO2(a).localeCompare(countryNameFromISO2(b)));

    const count = list.length;
    const noun = count === 1 ? "country is" : "countries are";
    const chips = list.map(iso2=>{
      const name = countryNameFromISO2(iso2);
      const flag = flagFromISO2(iso2);
      return `<div class="country-chip" data-iso2="${esc(String(iso2).toUpperCase())}" title="${esc(name)} (${iso2})">
        <span class="country-flag">${flag}</span><span class="country-name">${esc(name)}</span>
      </div>`;
    }).join("");

    mount.innerHTML = `<h2>${esc(viewLabel)} (${count} ${noun} celebrating) a national holiday</h2>
      <div class="country-chip-list">${chips}</div>`;
    mount.classList.toggle("hidden", count === 0);

    if (window.haMapHover?.clearHighlight) window.haMapHover.clearHighlight();
  }
  function hideCountryPanel() {
    const mount = document.getElementById("holiday-country-list");
    if (mount) mount.classList.add("hidden");
    if (window.haMapHover?.clearHighlight) window.haMapHover.clearHighlight();
  }
  // Expose tiny hooks so the Next-N block can call them
  window.haRenderCountryPanel = renderCountryPanel;
  window.haHideCountryPanel = hideCountryPanel;

  // ---- Loader + cache helpers (Today view) ----
  let TODAY_CACHE = { at: 0, list: [] };
  const TODAY_TTL_MS = 10 * 60 * 1000;

  function setLoading(isLoading, label = 'Loading…') {
    if (!loadingEl) return;
    if (isLoading) {
      loadingEl.textContent = label;
      loadingEl.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    } else {
      loadingEl.hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  }

  // Detect user's IANA zone once
  const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const TODAY_MODE = 'global'; // or 'local'

  async function fetchTodaySet(year) {
    const now = Date.now();
    if (now - TODAY_CACHE.at < TODAY_TTL_MS && TODAY_CACHE.list.length) return TODAY_CACHE.list;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (TODAY_MODE === 'global') { params.set('mode', 'global'); params.set('tz', USER_TZ); }
      else { params.set('mode', 'local'); }
      const res = await fetch(`/api/todaySet?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeout);
      const raw = res.ok ? await res.json() : { today: [] };
      const arr = Array.isArray(raw.today) ? raw.today : [];
      const norm = Array.from(new Set(arr.map(c => String(c).trim().toUpperCase().slice(0,2))));
      TODAY_CACHE = { at: now, list: norm };
      return norm;
    } catch {
      clearTimeout(timeout);
      return TODAY_CACHE.list || [];
    }
  }

  // For “today” tooltip details (names), reuse the /api/todaySet?date=YYYY-MM-DD endpoint
  async function fetchTodayItemsFor(dateISO) {
    try {
      const r = await fetch(`/api/todaySet?date=${dateISO}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'todaySet failed');
      const m = new Map();
      (j.items || []).forEach(x => {
        const key = String(x.iso2 || '').toUpperCase().slice(0,2);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(x.name);
      });
      return m;
    } catch {
      return new Map();
    }
  }

  function todayISO_UTC() {
    const n = new Date();
    const y = n.getUTCFullYear(), m = String(n.getUTCMonth()+1).padStart(2,'0'), d = String(n.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  async function getCountryDetails(iso2) {
    const key = `${iso2}-${YEAR}`;
    if (detailsCache.has(key)) return detailsCache.get(key);
    try {
      const r = await fetch(`/api/holidayDetails?iso2=${iso2}&year=${YEAR}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      const list = Array.isArray(data.holidays) ? data.holidays : [];
      detailsCache.set(key, list);
      return list;
    } catch {
      detailsCache.set(key, []);
      return [];
    }
  }

  // ---- Long Weekend fetcher (Nager.Date) ----
  async function getLongWeekends(iso2, year) {
    const key = `${iso2}-${year}`;
    if (longWeekendCache.has(key)) return longWeekendCache.get(key);
    try {
      const url = `https://date.nager.at/api/v3/LongWeekend/${year}/${iso2}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const list = await res.json();
      const dateSet = new Set();
      for (const lw of list) {
        const sd = parseLocalISODate(lw.startDate);
        const ed = parseLocalISODate(lw.endDate);
        for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          dateSet.add(`${y}-${m}-${dd}`);
        }
      }
      const payload = { list, dateSet };
      longWeekendCache.set(key, payload);
      return payload;
    } catch {
      const payload = { list: [], dateSet: new Set() };
      longWeekendCache.set(key, payload);
      return payload;
    }
  }

  // ---- All-Year national counts (precompute for stable hover) ----
  async function computeNatCount(iso2) {
    const list = await getCountryDetails(iso2); // uses cache
    return Array.isArray(list) ? list.filter(h => h && h.global === true).length : 0;
  }
  async function precomputeAllNatCounts(year) {
    const iso2s = Object.keys(TOTALS || {});
    const pool = 8; let i = 0;
    const workers = Array.from({ length: pool }, async () => {
      while (i < iso2s.length) {
        const iso2 = iso2s[i++];
        try {
          const n = await computeNatCount(iso2);
          NAT_COUNTS.set(iso2, n);
        } catch {
          NAT_COUNTS.set(iso2, Number.isFinite(TOTALS?.[iso2]?.national) ? TOTALS[iso2].national : 0);
        }
      }
    });
    await Promise.all(workers);
    COUNTS_READY = true;
  }
  function applyNatCountsToChart(chart, ALL_DATA) {
    const s = chart.series?.[0];
    if (!s) return;
    const updated = (s.mapData || []).map(p => {
      const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
      const iso2 = keyLc.toUpperCase();
      const name = (TOTALS[iso2]?.name) || iso2;
      const val = NAT_COUNTS.has(iso2) ? NAT_COUNTS.get(iso2) : null;
      return [keyLc, Number.isFinite(val) ? val : null, name];
    });
    s.setData(updated, false);
    if (Array.isArray(ALL_DATA)) {
      for (let row of ALL_DATA) {
        const iso2 = String(row[0] || '').toUpperCase();
        if (NAT_COUNTS.has(iso2)) row[1] = NAT_COUNTS.get(iso2);
      }
    }
  }

  // ---- Calendar renderer (12-month year grid) ----
  function renderCalendarHTML(year, holidays, longWeekendDates /* Set<string> yyyy-mm-dd */) {
    const holidayMap = new Map();
    holidays.forEach(h => {
      const d = h.date;
      if (!holidayMap.has(d)) holidayMap.set(d, []);
      holidayMap.get(d).push(h.name || h.localName || 'Holiday');
    });

    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();

    const monthNames = Array.from({ length: 12 }, (_, i) =>
      new Date(year, i, 1).toLocaleString(undefined, { month: 'long' })
    );
    const dow = ['S','M','T','W','T','F','S']; // Sunday-start

    const months = monthNames.map((mn, mIdx) => {
      const first = new Date(year, mIdx, 1);
      const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
      const startDOW = first.getDay();

      const blanks = Array.from({ length: startDOW }, () => `<div class="cal-day"></div>`);

      const days = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dLocal = new Date(year, mIdx, day);
        const yyyy = year;
        const mm = String(mIdx + 1).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;

        const isHoliday = holidayMap.has(key);
        const isToday  = (yyyy === todayY && mIdx === todayM && day === todayD);
        const isPast   = dLocal < new Date(todayY, todayM, todayD);
        const inLW     = longWeekendDates && longWeekendDates.has(key);

        const names = isHoliday ? holidayMap.get(key) : [];
        const longDate = dLocal.toLocaleDateString(undefined, {
          weekday:'short', year:'numeric', month:'long', day:'numeric'
        });

        let tip = longDate;
        if (isToday) tip += ' • Today';
        if (names.length) tip += ` — ${names.join(', ')}`;
        if (inLW) tip += names.length ? ' • Long Weekend' : ' — Long Weekend';

        const classes = [
          'cal-day',
          isHoliday ? 'holiday' : '',
          isPast && !isToday ? 'past' : '',
          inLW ? 'lw' : '',
          isToday ? 'today' : ''
        ].filter(Boolean).join(' ');

        const ariaCurrent = isToday ? ' aria-current="date"' : '';

        return `<div class="${classes}"${ariaCurrent} data-tip="${esc(tip)}" aria-label="${esc(tip)}" tabindex="0">${day}</div>`;
      });

      return `
        <section class="cal-month">
          <h4>${esc(mn)} ${year}</h4>
          <div class="cal-grid">
            ${dow.map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${blanks.join('')}${days.join('')}
          </div>
        </section>
      `;
    }).join('');

    return `<div class="year-cal">${months}</div>`;
  }

  // ---- Lightweight calendar tooltip (guarded if detailsBody exists) ----
  let calTipEl = null;
  function ensureCalTip() {
    if (calTipEl) return calTipEl;
    calTipEl = document.createElement('div');
    calTipEl.className = 'cal-tip';
    calTipEl.setAttribute('role', 'tooltip');
    calTipEl.hidden = true;
    document.body.appendChild(calTipEl);
    return calTipEl;
  }
  function showCalTipFor(el) {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    const tip = ensureCalTip();
    tip.textContent = text;
    const r = el.getBoundingClientRect();
    tip.style.left = Math.round(window.scrollX + r.left + r.width / 2) + 'px';
    tip.style.top  = Math.round(window.scrollY + r.top - 8) + 'px';
    tip.hidden = false;
  }
  function hideCalTip() { if (calTipEl) calTipEl.hidden = true; }

  if (detailsBody) {
    detailsBody.addEventListener('mouseover', (e) => {
      const day = e.target.closest('.cal-day');
      if (!day || !detailsBody.contains(day)) return;
      showCalTipFor(day);
    });
    detailsBody.addEventListener('mouseout', hideCalTip);
    detailsBody.addEventListener('focusin', (e) => {
      const day = e.target.closest('.cal-day');
      if (day) showCalTipFor(day);
    });
    detailsBody.addEventListener('focusout', hideCalTip);
    window.addEventListener('scroll', hideCalTip, { passive: true });
  }

  // ---- Details renderer (List/Calendar) ----
  async function renderDetails(iso2, displayName, holidays, regionCode = null, mode = CURRENT_MODE) {
    setDetailsPanelVisible(true);
    CURRENT_DETAILS = { iso2, displayName, holidays, regionCode };

    const all = Array.isArray(holidays) ? holidays : [];
    const natList = all.filter(h => h && h.global === true);

    const { dateSet: lwDates } = await getLongWeekends(iso2, YEAR);

    const suffix = regionCode ? ` — ${regionCode}` : '';
    const flag = flagFromISO2(iso2); // header only
    if (detailsTitle) {
      detailsTitle.innerHTML = `<span class="details-flag">${flag}</span>${esc(displayName)}${suffix} — Holidays (${YEAR})`;
    }

    const btnList = document.getElementById('details-view-list');
    const btnCal  = document.getElementById('details-view-cal');
    if (btnList && btnCal && !detailsTabsEl?.hidden) {
      btnList.classList.toggle('is-active', mode === 'list');
      btnList.setAttribute('aria-selected', mode === 'list' ? 'true' : 'false');
      btnCal.classList.toggle('is-active', mode === 'cal');
      btnCal.setAttribute('aria-selected', mode === 'cal' ? 'true' : 'false');
    }

    if (!detailsBody) return;

    if (!natList.length) {
      detailsBody.innerHTML = `<div class="note">No national holidays available.</div>`;
      hideCalTip();
      return;
    }

    if (mode === 'cal') {
      detailsBody.innerHTML = renderCalendarHTML(YEAR, natList, lwDates);
      hideCalTip();
      return;
    }

    // LIST view
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const sorted = natList.slice().sort((a, b) => parseLocalISODate(a.date) - parseLocalISODate(b.date));
    const byMonth = new Map();
    for (const h of sorted) {
      const d = parseLocalISODate(h.date);
      const m = d.getMonth();
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(h);
    }

    const sections = [];
    for (const [m, items] of byMonth) {
      const monthName = new Date(YEAR, m, 1).toLocaleString(undefined, { month: 'long' });

      const rows = items.map(h => {
        const d = parseLocalISODate(h.date);
        const isPast = d < today;

        const pretty = d.toLocaleDateString(undefined, {
          weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'
        });

        const primary = esc(h.name || 'Holiday');
        const local   = (h.localName && h.localName !== h.name) ? esc(h.localName) : null;

        const inLW = lwDates.has(h.date);
        const lwTag = inLW
          ? ` <span class="pill lw" title="This holiday falls within a long weekend">Long Week-End Alert</span>`
          : '';

        const pastCls = isPast ? ' past' : '';
        const pastStyle = isPast ? ' style="opacity:.55"' : '';

        return `
          <div class="row two-cols${pastCls}"${pastStyle}>
            <div class="cell">${esc(pretty)}</div>
            <div class="cell">
              ${local ? `<span class="note">${local}</span> — ${primary}` : primary}
              ${lwTag}
            </div>
          </div>
        `;
      }).join('');

      sections.push(`
        <section class="details-section">
          <h4 class="month-header">${esc(monthName)}</h4>
          <div class="rows">${rows}</div>
        </section>
      `);
    }

    detailsBody.innerHTML = sections.join('');
    hideCalTip();
  }

  // Helper used by All-Year tooltip to keep hover count consistent
  function getNatCountForTooltip(iso2, fallbackVal, year) {
    if (NAT_COUNTS.has(iso2)) return NAT_COUNTS.get(iso2);
    if (!COUNTS_READY) {
      if (Number.isFinite(fallbackVal)) return fallbackVal;
      if (Number.isFinite(TOTALS?.[iso2]?.national)) return TOTALS[iso2].national;
      return null;
    }
    return null;
  }

  // ---- Region list card & click wiring ----
  function renderRegionList(iso2) {
    const anchor = document.getElementById('region-list-anchor');
    if (!anchor) return;

    let card = document.getElementById('region-list');
    if (!card) {
      card = document.createElement('article');
      card.id = 'region-list';
      card.className = 'card';
      card.innerHTML = `<div><strong>States / Provinces</strong></div><div class="rows" id="region-rows"></div>`;
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }

    const rows = document.getElementById('region-rows');
    const m = REGIONS[iso2] || {};
    const entries = Object.entries(m).sort((a,b) => b[1] - a[1]);

    if (!entries.length) {
      rows.innerHTML = `<div class="note">No regional breakdown available.</div>`;
      return;
    }

    rows.innerHTML = entries.map(([code, count]) => `
      <div class="row region-row" data-code="${esc(code)}" style="cursor:pointer">
        <div class="cell">${esc(code)}</div>
        <div class="cell"><span class="pill">${count} regional</span></div>
      </div>
    `).join('');

    rows.querySelectorAll('.region-row').forEach(el => {
      const code = el.getAttribute('data-code');
      el.title = `${code}: ${m[code]} regional holidays`;
      el.addEventListener('click', async (evt) => {
        evt.preventDefault();
        const holidays = detailsCache.get(`${iso2}-${YEAR}`) || [];
        const countryName = (TOTALS[iso2]?.name) || iso2;
        await renderDetails(iso2, countryName, holidays, code, CURRENT_MODE);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
    });
  }

  // ---- Main init ----
  try {
    console.log("Holiday Atlas app.js — dynamic YEAR =", YEAR);

    // 1) Load totals JSON (cache-busted)
    const totalsRes = await fetch(`/data/totals-${YEAR}.json?v=${Date.now()}`, { cache: 'no-store' });
    const totalsJSON = await totalsRes.json();
    TOTALS  = totalsJSON.totals  || {};
    REGIONS = totalsJSON.regions || {};

    // 2) Build series data using hc-key (lowercased ISO2)
    const rows = Object.entries(TOTALS).map(([code, rec]) => [
      code.toLowerCase(),
      Number.isFinite(rec?.national) ? rec.national : null,
      rec?.name || code
    ]);

    // 3) Load a high-res Robinson world map (crisper)
    const topology = await fetch('https://code.highcharts.com/mapdata/custom/world-robinson-highres.geo.json')
      .then(r => r.json());

    // ===== CONTINENT LOOKUP (from topo + code list) ===========================
    function normCont(raw) {
      const v = String(raw || '').trim().toUpperCase();
      if (!v) return 'Other';
      if (v.includes('AFRICA')) return 'Africa';
      if (v.includes('ASIA') || v.includes('MIDDLE EAST')) return 'Asia';
      if (v.includes('EUROPE')) return 'Europe';
      if (v.includes('NORTH AMERICA') || v.includes('CARIBBEAN') || v.includes('CENTRAL AMERICA')) return 'North America';
      if (v.includes('SOUTH AMERICA')) return 'South America';
      if (v.includes('OCEANIA') || v.includes('AUSTRALIA') || v.includes('PACIFIC')) return 'Oceania';
      return 'Other';
    }

    // Build from topo (no extra calls)
    const contFromTopo = new Map();
    try {
      const feats = (topology && topology.features) || [];
      for (const f of feats) {
        const p = (f && f.properties) || {};
        const iso2 = String(p['iso-a2'] || p['hc-key'] || p['iso_a2'] || p['country-key'] || '').toUpperCase();
        const rawRegion = p['continent'] || p['region-un'] || p['region'] || p['region-wb'] || p['subregion'] || '';
        if (iso2.length === 2) contFromTopo.set(iso2, normCont(rawRegion));
      }
    } catch { /* ignore */ }

    // Fallback from your country code list
    const codeList = normalizeCodeList?.() || {};
    const contFromCodes = new Map(
      Object.entries(codeList).map(([k, v]) => [String(k).toUpperCase(), normCont(v?.continent || v?.region)])
    );

    // Unified getter
    const getContinent = (iso2) => contFromTopo.get(iso2) || contFromCodes.get(iso2) || 'Other';

    // ✅ Build the missing map used by most-table
    const continentByIso2 = Object.fromEntries(
      Object.keys(TOTALS).map(iso2 => [iso2, getContinent(iso2)])
    );
    // ========================================================================

    // 4) Render map
    const chart = Highcharts.mapChart('wpr-map', {
      chart: {
        map: topology,
        spacing: [0, 0, 0, 0],
        backgroundColor: 'transparent',
        animation: false
      },
      title: { text: null },
      credits: { enabled: true },
      accessibility: { enabled: false },

      exporting: {
        enabled: true,
        buttons: {
          contextButton: { align: 'right', verticalAlign: 'top', x: -8, y: 8, theme: { r: 8 } }
        }
      },

      mapNavigation: {
        enabled: true,
        enableButtons: true,
        enableMouseWheelZoom: true,
        enableDoubleClickZoomTo: false,
        enableDoubleClickZoom: false,
        enableTouchZoom: false,
        buttonOptions: {
          align: 'right',
          verticalAlign: 'top',
          x: -8,
          y: 56,
          theme: {
            fill: '#fff',
            stroke: '#cfd7e6',
            'stroke-width': 1,
            r: 8,
            states: {
              hover: { fill: '#e8f3ff' },
              select: { fill: '#cde3ff' }
            }
          }
        },
        buttons: { zoomIn: {}, zoomOut: { y: 44 } }
      },

      legend: {
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { fontSize: '12px' }
      },

      colorAxis: {
        dataClassColor: 'category',
        dataClasses: [
          { to: 4,              color: '#E7F6BC', name: '≤ 4' },
          { from: 5,  to: 7,    color: '#BEE6B6', name: '5-7' },
          { from: 8,  to: 10,   color: '#81CEBC', name: '8-10' },
          { from: 11, to: 13,   color: '#288DBB', name: '11-13' },
          { from: 14, to: 19,   color: '#2160A8', name: '14-19' },
          { from: 20,           color: '#081D58', name: '20+' }
        ],
        nullColor: '#c8ced8',
        labels: { formatter: function() { return this.value ? Math.round(this.value) : this.value; } }
      },

      tooltip: {
        useHTML: true,
        headerFormat: '',
        followPointer: true,
        shadow: false,
        animation: false,
        hideDelay: 0,
        formatter: function () {
          const key = (this.point.options && (this.point.options['hc-key'] || this.point.options.hckey || this.point.options.key)) ||
                      this.point['hc-key'] || this.point.key || '';
          const iso2 = String(key).toUpperCase();
          const name = this.point.name || this.point.options?.label || iso2;
          const val = (typeof this.point.value === 'number') ? this.point.value : null;

          if (CURRENT_VIEW === 'today') {
            const list = TODAY_ITEMS_MAP.get(iso2) || [];
            if (!list.length) {
              return `<strong>${esc(name)}</strong><br/><span class="pill">No national holiday today</span>`;
            }
            const pretty = TODAY_PRETTY_DATE || new Date().toLocaleDateString(undefined, {
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
            });
            const lines = list.map(nm => `${esc(pretty)} — ${esc(nm)}`).join('<br/>');
            return `<strong>${esc(name)}</strong><br/>${lines}`;
          }

          if (CURRENT_VIEW === 'range') {
            const items = RANGE_ITEMS_MAP.get(iso2) || [];
            if (!items.length) {
              return `<strong>${esc(name)}</strong><br/><span class="pill">No holiday in window</span>`;
            }
            items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
            const lines = items.map(it => {
              const [yy, mm, dd] = String(it.date).split('-').map(Number);
              const pretty = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
              });
              return `${esc(pretty)} — ${esc(it.name)}`;
            }).slice(0, 8).join('<br/>');
            return `<strong>${esc(name)}</strong><br/>${lines}`;
          }

          if (CURRENT_VIEW === 'all') {
            const count = getNatCountForTooltip(iso2, val, YEAR);
            if (!COUNTS_READY && count == null) {
              return `<strong>${esc(name)}</strong><br/><span class="pill">Computing…</span>`;
            }
            return `<div class="tt-card">
              <div class="tt-title">${esc(name)}</div>
              <div class="tt-count">${count == null ? 'No data' : count + ' holidays'}</div>
            </div>`;
          }

          return `<strong>${esc(name)}</strong>`;
        }
      },

      plotOptions: {
        series: {
          states: {
            hover:  { animation: { duration: 0 }, halo: false },
            inactive: { opacity: 1 }
          },
          animation: false,
          nullInteraction: true,
          enableMouseTracking: true,
          cursor: 'pointer'
        }
      },

      series: [{
        type: 'map',
        mapData: topology,
        data: rows,
        keys: ['hc-key','value','label'],
        joinBy: ['hc-key','hc-key'],
        allAreas: true,

        borderColor: '#000',
        borderWidth: 0.15,
        allowPointSelect: false,
        inactiveOtherPoints: false,
        states: {
          hover:  { color: '#ffe082', animation: { duration: 0 }, halo: false, borderWidth: 0.15, borderColor: '#000', brightness: 0.10 },
          select: { borderWidth: 0.15, borderColor: '#000', brightness: 0 },
          inactive: { enabled: false }
        },
        dataLabels: { enabled: false },

        point: {
          events: {
            mouseOver: function () {
              const c = this.series.chart;
              c.tooltip.refresh(this);
              this.setState('hover');
            },
            mouseOut: function () {
              const c = this.series.chart;
              c.tooltip.hide(0);
              this.setState();
            },
            click: async function () {
              if (CURRENT_VIEW !== 'all' || !COUNTS_READY) return;

              const hcKey = (this.options['hc-key'] || this['hc-key'] || '').toUpperCase();
              const iso2  = hcKey;
              const display = (TOTALS[iso2]?.name) || this.name || iso2;

              // --- TOGGLE-OFF logic: click the same yellow country to reset ---
              if (SELECTED_KEY === iso2) {
                resetAllYearSelection();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                return;
              }

              applySelection(this, hcKey);

              try {
                const holidays = await getCountryDetails(iso2);
                await renderDetails(iso2, display, holidays, null, CURRENT_MODE);
                renderRegionList(iso2);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              } catch {
                await renderDetails(iso2, display, [], null, CURRENT_MODE);
                renderRegionList(iso2);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              }
            }
          }
        }
      }]
    });

    // === Map hover API: highlight countries from external UI (chips) ===
    function getPointByIso2(iso2) {
      const keyLc = String(iso2).toLowerCase();
      const s = chart.series[0];
      if (!s?.points?.length) return null;
      return s.points.find(p => {
        const hcKey = (p.options && (p.options['hc-key'] || p.options.key)) || p['hc-key'] || p.key;
        return String(hcKey).toLowerCase() === keyLc;
      });
    }

    let currentHoverPoint = null;
    function highlightCountryOnMap(iso2) {
      const p = getPointByIso2(iso2);
      if (!p) return;
      if (currentHoverPoint && currentHoverPoint !== p) currentHoverPoint.setState('');
      p.setState('hover');
      chart.tooltip && chart.tooltip.refresh(p);
      currentHoverPoint = p;
    }
    function clearHighlight() {
      if (currentHoverPoint) {
        currentHoverPoint.setState('');
        chart.tooltip && chart.tooltip.hide(0);
        currentHoverPoint = null;
      }
    }
    window.haMapHover = { highlightCountryOnMap, clearHighlight };

    // Chip → map hover/focus (single delegation block)
    document.addEventListener('mouseover', (e) => {
      const chip = e.target.closest('.country-chip');
      if (!chip || !chip.dataset.iso2) return;
      highlightCountryOnMap(chip.dataset.iso2);
    });

    // Avoid clearing when moving between children of the same chip
    document.addEventListener('mouseout', (e) => {
      const fromChip = e.target.closest('.country-chip');
      const toChip   = e.relatedTarget && e.relatedTarget.closest?.('.country-chip');
      if (fromChip && fromChip !== toChip) clearHighlight();
    });

    document.addEventListener('focusin', (e) => {
      const chip = e.target.closest('.country-chip');
      if (!chip || !chip.dataset.iso2) return;
      highlightCountryOnMap(chip.dataset.iso2);
    });

    document.addEventListener('focusout', (e) => {
      const fromChip = e.target.closest('.country-chip');
      const toChip   = e.relatedTarget && e.relatedTarget.closest?.('.country-chip');
      if (fromChip && fromChip !== toChip) clearHighlight();
    });

    // === Thin, crisp global borders that stay visually consistent ===
    const BORDER_MIN = 0.35;
    const BORDER_MAX = 2.2;

    function computeBaseBorderWidth(c) {
      const pw = c?.plotWidth || c?.chartWidth || 800;
      const adaptive = pw * 0.0014;
      return Math.max(0.8, Math.min(1.8, adaptive));
    }

    const borderLines = Highcharts.geojson(topology, 'mapline');
    chart.addSeries({
      id: 'borders',
      type: 'mapline',
      data: borderLines,
      color: '#aab6c8',
      lineWidth: computeBaseBorderWidth(chart),
      enableMouseTracking: false,
      showInLegend: false,
      zIndex: 9,
      states: { inactive: { enabled: false } }
    }, false);

    function syncBorderWidth() {
      const s = chart.get('borders');
      if (!s) return;
      const scale = (chart.mapView && chart.mapView.getScale && chart.mapView.getScale()) || 1;
      const base  = computeBaseBorderWidth(chart);
      const lw = Math.max(BORDER_MIN, Math.min(BORDER_MAX, base / scale));
      s.update({ lineWidth: lw }, false);
    }

    syncBorderWidth();
    chart.update({
      chart: { events: { redraw: syncBorderWidth, load: syncBorderWidth } }
    }, false);
    chart.redraw();

    // --- Selection helpers ---
    function applySelection(point, keyUpper) {
      if (SELECTED_POINT && SELECTED_POINT.update) {
        SELECTED_POINT.update({ color: null }, false);
      }
      point.update({ color: '#ffc54d' }, false);
      chart.redraw();
      SELECTED_POINT = point;
      SELECTED_KEY = keyUpper;
    }
    function clearSelectionColor() {
      if (SELECTED_POINT && SELECTED_POINT.update) {
        SELECTED_POINT.update({ color: null }, false);
        chart.redraw();
      }
    }
    function reapplySelectionIfAllYear() {
      if (CURRENT_VIEW !== 'all' || !SELECTED_KEY) return;
      const s = chart.series?.[0];
      if (!s?.points?.length) return;
      const pt = s.points.find(p => String(
        (p.options && (p.options['hc-key'] || p.options.hckey || p.options.key)) ||
        p['hc-key'] || p.key || ''
      ).toUpperCase() === SELECTED_KEY);
      if (pt) applySelection(pt, SELECTED_KEY);
      else SELECTED_POINT = null;
    }

    // --- NEW: full reset for All Year (no country, no list/calendar) ---
    function resetAllYearSelection() {
      clearSelectionColor();
      SELECTED_POINT = null;
      SELECTED_KEY = null;
      if (detailsTitle) detailsTitle.textContent = '';
      if (detailsBody)  detailsBody.innerHTML = '';
      CURRENT_DETAILS = null;
      setDetailsPanelVisible(false);
      showDetailsTabs(false);
    }

    // === PRECOMPUTE: lock interactions, compute All-Year counts, then apply ===
    chart.update({ plotOptions: { series: { enableMouseTracking: false, cursor: 'default' } } }, false);
    setLoading(true, 'Computing national counts…');
    let ALL_DATA = rows.slice();

    try {
      await precomputeAllNatCounts(YEAR);
      applyNatCountsToChart(chart, ALL_DATA);
    } finally {
      chart.update({ plotOptions: { series: { enableMouseTracking: true, cursor: 'pointer', states: { inactive: { enabled: false } } } } }, false);
      chart.redraw();
      setLoading(false);
    }

    // ✅ Most-table feed (now with a defined continentByIso2)
    const tableRows = Object.keys(TOTALS).map(iso2 => ({
      country: TOTALS[iso2]?.name || iso2,
      iso2,
      holidays: (NAT_COUNTS.has(iso2)
        ? NAT_COUNTS.get(iso2)
        : (Number.isFinite(TOTALS[iso2]?.national) ? TOTALS[iso2].national : 0)),
      continent: continentByIso2[iso2] || 'Other'
    }));
    mountMostTable(tableRows);
    reapplySelectionIfAllYear();

    // Painter for Next N
    window.haColorCountries = function (iso2UpperList, itemsFlat = [], countsByIso2 = new Map()) {
      clearSelectionColor();
      clearHighlight();

      RANGE_ITEMS_MAP = new Map();
      (itemsFlat || []).forEach(x => {
        const k = String(x.iso2 || '').toUpperCase().slice(0, 2);
        if (!RANGE_ITEMS_MAP.has(k)) RANGE_ITEMS_MAP.set(k, []);
        RANGE_ITEMS_MAP.get(k).push({ date: String(x.date), name: x.name });
      });

      const countsMap = countsByIso2 instanceof Map
        ? countsByIso2
        : new Map(Object.entries(countsByIso2 || {}).map(([k, v]) => [String(k).toUpperCase().slice(0,2), Number(v) || 0]));

      const lcSet = new Set((iso2UpperList || []).map(c => String(c).toLowerCase()));
      const mapData = chart.series[0].mapData || [];
      const data = mapData.map(p => {
        const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
        const iso2 = keyLc.toUpperCase();
        const count = countsMap.has(iso2) ? (countsMap.get(iso2) || 0) : (lcSet.has(keyLc) ? 1 : 0);
        return [keyLc, count > 0 ? count : null, (TOTALS[iso2]?.name) || iso2];
      });

      chart.update({
        colorAxis: {
          dataClassColor: 'category',
          dataClasses: [
            { to: 1,           color: '#BEE6B6', name: '1 holiday' },
            { from: 2, to: 3,  color: '#48B2C1', name: '2-3 holidays' },
            { from: 4,         color: '#2160A8', name: '4+ holidays' },
          ],
          nullColor: '#d9d9d9'
        }
      }, false);

      chart.series[0].setData(data, false);
      chart.redraw();

      CURRENT_VIEW = 'range';
      showDetailsTabs(false);
      setDetailsPanelVisible(false);
    };

    // ---- View tags (All Year / Today) ----
    const tagsEl = document.querySelector('.view-tags');
    if (tagsEl) {
      tagsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-tag');
        if (!btn) return;

        tagsEl.querySelectorAll('.view-tag').forEach(b => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        setView(btn.dataset.view); // 'all' | 'today' (next7/30 are intercepted below)
      });
    }

    // Warm the Today cache in the background
    fetchTodaySet(YEAR).catch(() => {});

    // ---- Details view toggles (List / Calendar) ----
    const detailsTabs = document.querySelector('.details-views');
    if (detailsTabs) {
      detailsTabs.addEventListener('click', async (e) => {
        const btn = e.target.closest('.details-view');
        if (!btn || !CURRENT_DETAILS) return;

        const next = btn.id === 'details-view-cal' ? 'cal' : 'list';
        if (next === CURRENT_MODE) return;
        CURRENT_MODE = next;

        const { iso2, displayName, holidays, regionCode } = CURRENT_DETAILS;
        await renderDetails(iso2, displayName, holidays, regionCode, CURRENT_MODE);
      });
    }

    // ---- View switching (Map: All Year vs Today) ----
    const ALL_COLOR_CLASSES = [
      { to: 4,              color: '#E7F6BC', name: '≤ 4' },
      { from: 5,  to: 7,    color: '#BEE6B6', name: '5-7' },
      { from: 8,  to: 10,   color: '#81CEBC', name: '8-10' },
      { from: 11, to: 13,   color: '#288DBB', name: '11-13' },
      { from: 14, to: 19,   color: '#2160A8', name: '14-19' },
      { from: 20,           color: '#081D58', name: '20+' }
    ];

    async function setView(view) {
      if (view === CURRENT_VIEW) return;
      CURRENT_VIEW = view;

      if (view === 'all') {
        const mapData = chart.series[0].mapData || [];
        const data = mapData.map(p => {
          const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
          const iso2 = keyLc.toUpperCase();
          const val = NAT_COUNTS.has(iso2) ? NAT_COUNTS.get(iso2) : null;
          return [keyLc, Number.isFinite(val) ? val : null, (TOTALS[iso2]?.name) || iso2];
        });

        chart.update({
          colorAxis: { dataClasses: ALL_COLOR_CLASSES, dataClassColor: 'category', nullColor: '#d9d9d9' }
        }, false);
        chart.series[0].setData(data, false);
        chart.redraw();

        hideCountryPanel();
        clearHighlight();
        setDetailsPanelVisible(false);
        showDetailsTabs(false);
        return;
      }

      // --- TODAY ---
      setDetailsPanelVisible(false);
      showDetailsTabs(false);

      setLoading(true, 'Loading Today…');

      const todayISO = todayISO_UTC();
      TODAY_ITEMS_MAP = await fetchTodayItemsFor(todayISO);

      const [yy, mm, dd] = todayISO.split('-').map(Number);
      TODAY_PRETTY_DATE = new Date(yy, mm - 1, dd).toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
      });

      const todayList = await fetchTodaySet(YEAR);
      const todaySet = new Set(todayList.map(c => c.toLowerCase()));

      const mapData = chart.series[0].mapData || [];
      const todayData = mapData.map(p => {
        const keyLc = String(p && (p['hc-key'] || p.hckey || p.key) || '').toLowerCase();
        const iso2 = keyLc.toUpperCase();
        const hasHoliday = todaySet.has(keyLc);
        return [keyLc, hasHoliday ? 1 : null, (TOTALS[iso2]?.name) || iso2];
      });

      chart.update({
        colorAxis: {
          dataClassColor: 'category',
          dataClasses: [
            { to: 0, color: '#d9d9d9', name: 'No national holiday today' },
            { from: 1, color: '#BEE6B6', name: 'National Holiday today' }
          ],
          nullColor: '#d9d9d9'
        }
      }, false);

      chart.series[0].setData(todayData, false);
      chart.redraw();
      setLoading(false);

      renderCountryPanel("Today", todayList);
    }

  } catch (err) {
    console.error('Init failed:', err);
    const el = document.getElementById('wpr-map');
    if (el) el.innerHTML = '<div class="note" style="padding:16px">Failed to load map.</div>';
  }
})();

/* ===== Next N days powered by todaySet (no hardcoded JSON) =============== */
(() => {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;

  function todayISO() {
    const n = new Date();
    return isoUTC(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
  }

  async function fetchDay(dateISO) {
    const r = await fetch(`/api/todaySet?date=${dateISO}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `todaySet failed for ${dateISO}`);
    return j; // {date, today:[], items:[{iso2,name}]}
  }

  async function showNext(days) {
    try {
      const start = todayISO();
      const [y, m, d] = start.split('-').map(Number);
      const startDt = new Date(Date.UTC(y, m - 1, d));
      const dates = Array.from({ length: days }, (_, i) => {
        const dt = new Date(startDt); dt.setUTCDate(dt.getUTCDate() + i);
        return isoUTC(dt);
      });

      const results = await Promise.all(dates.map(fetchDay));

      // Flat items with date for tooltips
      const iso2Set = new Set();
      const itemsFlat = [];

      // Count total holidays per country in the window
      const counts = new Map();

      results.forEach(r => {
        if (r.items?.length) {
          r.items.forEach(x => {
            const iso2 = String(x.iso2 || '').toUpperCase().slice(0, 2);
            iso2Set.add(iso2);
            itemsFlat.push({ iso2, name: x.name, date: r.date });
            counts.set(iso2, (counts.get(iso2) || 0) + 1);
          });
        }
        (r.today || []).forEach(c => iso2Set.add(String(c).toUpperCase().slice(0, 2)));
      });

      if (typeof window.haColorCountries === 'function') {
        window.haColorCountries(Array.from(iso2Set).sort(), itemsFlat, counts);
      }

      const label = days === 7 ? "Next 7 Days" : "Next 30 Days";
      if (typeof window.haRenderCountryPanel === 'function') {
        window.haRenderCountryPanel(label, Array.from(iso2Set).sort());
      }
    } catch (e) {
      console.error('[nextN] error', e);
    }
  }

  function setActive(btn) {
    document.querySelectorAll('.view-tag').forEach(b => b.classList.remove('is-active'));
    btn?.classList.add('is-active');
  }

  const btn7 = document.querySelector('[data-view="next7"]');
  if (btn7) {
    btn7.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setActive(e.currentTarget);
      showNext(7);
    }, { capture: true });
  }

  const btn30 = document.querySelector('[data-view="next30"]');
  if (btn30) {
    btn30.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setActive(e.currentTarget);
      showNext(30);
    }, { capture: true });
  }
})();
