// public/most-table.js
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const flagFromISO2 = iso2 => iso2?.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt())) || '🏳️';

function render(tbody, rows) {
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

export function mountMostTable(rows) {
  const section = document.getElementById('most');
  const table   = section?.querySelector('#holiday-table');
  const tbody   = table?.querySelector('tbody');
  if (!tbody) return;

  // default sort: holidays desc
  let data = [...rows].sort((a,b) => (b.holidays ?? -Infinity) - (a.holidays ?? -Infinity));
  render(tbody, data);

  // click-to-sort
  const headers = table.querySelectorAll('th.sortable');
  let state = { key: 'holidays', dir: 'desc' };

  const apply = () => {
    const { key, dir } = state;
    const type = table.querySelector(`th[data-key="${key}"]`)?.dataset.type || 'string';
    const sorted = [...data].sort((a,b) => {
      const va = a[key], vb = b[key];
      const cmp = type === 'number'
        ? (va ?? -Infinity) - (vb ?? -Infinity)
        : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
    headers.forEach(h => h.setAttribute('aria-sort',
      h.dataset.key === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
    ));
    render(tbody, sorted);
  };

  headers.forEach(h => h.addEventListener('click', () => {
    const key = h.dataset.key;
    const type = h.dataset.type || 'string';
    state = (state.key === key)
      ? { ...state, dir: state.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: type === 'number' ? 'desc' : 'asc' };
    apply();
  }));

  apply();
}
