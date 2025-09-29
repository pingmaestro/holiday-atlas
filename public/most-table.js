// public/most-table.js

// --- utils ---
const esc = s => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
);
const flagFromISO2 = iso2 =>
  iso2?.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt())) || '🏳️';

// --- Robust continent normalizer (handles fuzzy labels) ---
function normCont(raw) {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return 'Other';

  // Exact matches
  if (v === 'AFRICA') return 'Africa';
  if (v === 'ASIA') return 'Asia';
  if (v === 'EUROPE') return 'Europe';
  if (v === 'NORTH AMERICA') return 'North America';
  if (v === 'SOUTH AMERICA') return 'South America';
  if (v === 'OCEANIA' || v === 'AUSTRALIA/OCEANIA') return 'Oceania';
  if (v === 'AMERICAS') return 'North America'; // treat generic "Americas" as NA

  // Fuzzy buckets
  if (v.includes('AFRICA')) return 'Africa'; // "Sub-Saharan Africa", "Northern Africa"
  if (v.includes('MIDDLE EAST') || v.includes('WESTERN ASIA') || v.includes('ASIA')) return 'Asia';
  if (v.includes('EUROPE')) return 'Europe';
  if (v.includes('SOUTH AMERICA')) return 'South America';
  if (v.includes('CENTRAL AMERICA') || v.includes('CARIBBEAN') || v.includes('NORTH AMERICA')) return 'North America';
  if (v.includes('OCEANIA') || v.includes('AUSTRALIA') || v.includes('PACIFIC')) return 'Oceania';

  // Rare/unknown
  if (v.includes('ANTARCTICA')) return 'Other';

  return 'Other';
}

// --- render rows ---
function renderRows(tbody, rows) {
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>
        <div class="country-cell">
          <span class="country-flag" title="${esc(r.iso2)}">${flagFromISO2(r.iso2)}</span>
          <span class="country-name">${esc(r.country)}</span>
        </div>
      </td>
      <td class="num">${Number(r.holidays).toLocaleString()}</td>
    </tr>
  `).join('');
}

// --- sorting setup ---
function setupSorting(table, data) {
  const headers = table.querySelectorAll('th.sortable');
  const tbody   = table.querySelector('tbody');
  let state = { key: 'holidays', dir: 'desc', type: 'number' };

  const apply = rows => {
    const { key, dir, type } = state;
    const sorted = [...rows].sort((a,b) => {
      const va = a[key], vb = b[key];
      const cmp = type === 'number'
        ? (va ?? -Infinity) - (vb ?? -Infinity)
        : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
    headers.forEach(h => {
      h.setAttribute(
        'aria-sort',
        h.dataset.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
      );
    });
    renderRows(tbody, sorted);
  };

  headers.forEach(h => {
    h.addEventListener('click', () => {
      const key = h.dataset.key;
      const type = h.dataset.type || 'string';
      if (state.key === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state = { key, dir: type === 'number' ? 'desc' : 'asc', type };
      }
      apply(data.current);
    });
  });

  return { applySortOn: rows => apply(rows) };
}

// --- Dynamic filter bar (chips to the right of H2; only for continents present; always shows All) ---
function makeFilterBar(section, data, sorter) {
  // Which continents are actually present after normalization?
  const presentSet = new Set(data.original.map(r => r.continent));
  // Preferred order (exclude Other from chips; we’ll add it only if it's the only thing present)
  const order = ['Africa','Asia','Europe','North America','South America','Oceania'];
  let chips = order.filter(c => presentSet.has(c));

  // If nothing matched (everything is "Other"), still show an "Other" chip too
  const onlyOther = chips.length === 0 && presentSet.has('Other');
  if (onlyOther) chips = ['Other'];

  // Wrap h2 + filters in a flex header row
  let head = section.querySelector('.table-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'table-head';
    const h2 = section.querySelector('h2');
    if (h2) head.appendChild(h2);
    section.insertBefore(head, section.firstChild);
    Object.assign(head.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: '8px'
    });
  }

  // Build bar: always include "All" at the end
  const bar = document.createElement('div');
  bar.className = 'table-filters';
  const buttons = [...chips, 'All']
    .map(name => `<button class="pill ${name==='All'?'is-active':''}" data-cont="${name}" aria-pressed="${name==='All'?'true':'false'}">${name}</button>`)
    .join(' ');
  bar.innerHTML = buttons;
  head.appendChild(bar);

  // Click handling
  bar.addEventListener('click', e => {
    const btn = e.target.closest('button[data-cont]');
    if (!btn) return;

    bar.querySelectorAll('button').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const sel = btn.dataset.cont;
    data.current = sel === 'All'
      ? [...data.original]
      : data.original.filter(r => r.continent === sel);

    sorter.applySortOn(data.current);
  });
}

// --- public mount ---
export function mountMostTable(rows) {
  const section = document.getElementById('most');
  const table   = section?.querySelector('#holiday-table');
  const tbody   = table?.querySelector('tbody');
  if (!tbody) return;

  // Normalize continent and keep both original & current sets
  const normalized = rows.map(r => ({ ...r, continent: normCont(r.continent) }));
  const data = { original: normalized, current: [...normalized] };

  // default render: holidays desc
  data.current.sort((a,b) => (b.holidays ?? -Infinity) - (a.holidays ?? -Infinity));
  renderRows(tbody, data.current);

  // sorting + filters
  const sorter = setupSorting(table, data);
  sorter.applySortOn(data.current);
  makeFilterBar(section, data, sorter);
}
