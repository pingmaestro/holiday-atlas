// public/most-table.js
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const flagFromISO2 = iso2 => iso2?.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt())) || '🏳️';

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

function makeFilters(section, rows) {
  // If no continent info, don’t show filters
  const hasContinent = rows.some(r => r.continent);
  if (!hasContinent) return null;

  const wanted = ['All','Africa','Asia','Europe','North America','South America','Oceania'];
  const wrap = document.createElement('div');
  wrap.className = 'table-filters'; // uses your existing pill styles if you have them
  wrap.style.margin = '8px 0 12px';

  wrap.innerHTML = wanted.map((name, i) =>
    `<button class="pill ${i===0?'is-active':''}" data-cont="${esc(name)}" aria-pressed="${i===0?'true':'false'}">${esc(name)}</button>`
  ).join(' ');

  section.insertBefore(wrap, section.querySelector('.table-wrap'));
  return wrap;
}

function setupSorting(table, data) {
  const headers = table.querySelectorAll('th.sortable');
  const tbody = table.querySelector('tbody');
  let state = { key: 'holidays', dir: 'desc', type: 'number' };

  const apply = (rows) => {
    const { key, dir, type } = state;
    const sorted = [...rows].sort((a,b) => {
      const va = a[key], vb = b[key];
      const cmp = type === 'number'
        ? (va ?? -Infinity) - (vb ?? -Infinity)
        : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
    headers.forEach(h => h.setAttribute('aria-sort',
      h.dataset.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
    ));
    renderRows(tbody, sorted);
  };

  headers.forEach(h => {
    h.addEventListener('click', () => {
      const key = h.dataset.key;
      const type = h.dataset.type || 'string';
      state = (state.key === key)
        ? { ...state, dir: state.dir === 'asc' ? 'desc' : 'asc', type }
        : { key, dir: type === 'number' ? 'desc' : 'asc', type };
      apply(data.current);
    });
  });

  // expose a hook so filters can re-apply sort on the current subset
  return { applySortOn: rows => apply(rows) };
}

export function mountMostTable(rows) {
  const section = document.getElementById('most');
  const table   = section?.querySelector('#holiday-table');
  const tbody   = table?.querySelector('tbody');
  if (!tbody) return;

  // keep a mutable "current subset"
  const data = { original: [...rows], current: [...rows] };

  // default render (holidays desc)
  data.current.sort((a,b) => (b.holidays ?? -Infinity) - (a.holidays ?? -Infinity));
  renderRows(tbody, data.current);

  // sorting
  const sorter = setupSorting(table, data);
  sorter.applySortOn(data.current);

  // filters
  const filters = makeFilters(section, rows);
  if (!filters) return;

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cont]');
    if (!btn) return;
    filters.querySelectorAll('button').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const sel = btn.dataset.cont;
    if (sel === 'All') {
      data.current = [...data.original];
    } else {
      data.current = data.original.filter(r => (r.continent || 'Other') === sel);
    }
    sorter.applySortOn(data.current);
  });
}
