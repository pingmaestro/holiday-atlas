// public/most-table.js

const esc = s => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
);
const flagFromISO2 = iso2 =>
  iso2?.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt())) || '🏳️';

// --- Normalize continent labels ---
const CANON = new Map([
  ['AFRICA','Africa'],
  ['ASIA','Asia'],
  ['EUROPE','Europe'],
  ['NORTH AMERICA','North America'],
  ['SOUTH AMERICA','South America'],
  ['OCEANIA','Oceania'],
  ['AMERICAS','North America'],
  ['OTHER','Other']
]);
const normCont = v => CANON.get(String(v || 'Other').toUpperCase()) || 'Other';

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

function makeFilterBar(section, data, sorter) {
  const wanted = ['Oceania','South America','North America','Europe','Asia','Africa','All'];

  // Wrap h2 + filters in a flex header row
  let head = section.querySelector('.table-head');
  if (!head) {
    head = document.createElement('div');
    head.className = 'table-head';
    const h2 = section.querySelector('h2');
    if (h2) head.appendChild(h2);
    section.insertBefore(head, section.firstChild);
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.flexWrap = 'wrap';
    head.style.gap = '8px';
  }

  const bar = document.createElement('div');
  bar.className = 'table-filters';
  bar.innerHTML = wanted.map((name,i)=>
    `<button class="pill ${i===wanted.length-1?'is-active':''}" data-cont="${name}" aria-pressed="${i===wanted.length-1?'true':'false'}">${name}</button>`
  ).join(' ');
  head.appendChild(bar);

  bar.addEventListener('click', e => {
    const btn = e.target.closest('button[data-cont]');
    if (!btn) return;
    bar.querySelectorAll('button').forEach(b=>{
      const active = b===btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true':'false');
    });
    const sel = btn.dataset.cont;
    data.current = sel === 'All'
      ? [...data.original]
      : data.original.filter(r => r.continent === sel);
    sorter.applySortOn(data.current);
  });
}

export function mountMostTable(rows) {
  const section = document.getElementById('most');
  const table   = section?.querySelector('#holiday-table');
  const tbody   = table?.querySelector('tbody');
  if (!tbody) return;

  // normalize continent field
  const normalized = rows.map(r => ({ ...r, continent: normCont(r.continent) }));

  const data = { original: normalized, current: [...normalized] };

  // default: sort by holidays desc
  data.current.sort((a,b) => (b.holidays ?? -Infinity) - (a.holidays ?? -Infinity));
  renderRows(tbody, data.current);

  const sorter = setupSorting(table, data);
  sorter.applySortOn(data.current);

  makeFilterBar(section, data, sorter);
}
