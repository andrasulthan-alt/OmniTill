import { h, mount, money, toast, errText, openModal, busy, dt, today, addDays, promptBox, debounce } from '../util.js';
import { icon } from '../icons.js';
import { S, on, isManager } from '../state.js';
import { rpc, run } from '../api.js';
import { receiptNode, printReceipt, methodLabel, channelLabel } from '../receipt.js';

export async function render(view) {
  const offs = [];
  const st = { day: today(), q: '' };
  const body = h('div');
  const day = h('input', { type: 'date', value: st.day, 'aria-label': 'Day', onchange: (e) => { st.day = e.target.value; load(); } });
  const q = h('input', { type: 'search', placeholder: 'Search receipt, guest, table', 'aria-label': 'Search sales', oninput: debounce((e) => { st.q = e.target.value.trim().toLowerCase(); paint(); }, 120) });
  day.style.maxWidth = '170px';
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Sales'), h('div', { class: 'row gap' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => shift(-1) }, icon('back', 20)), day, h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => shift(1) }, icon('arrow', 20)))),
    h('div', { class: 'toolbar' }, q), body);
  const shift = (n) => { st.day = addDays(st.day, n); day.value = st.day; load(); };

  let rows = [];
  async function load() {
    mount(body, h('p', { class: 'mono' }, 'Loading'));
    try {
      const lo = new Date(`${addDays(st.day, -1)}T12:00:00Z`).toISOString(), hi = new Date(`${addDays(st.day, 1)}T12:00:00Z`).toISOString();
      const data = await run(S.sb.from('sales').select('*, sale_items(name,qty,price)').gte('created_at', lo).lte('created_at', hi).order('created_at', { ascending: false }).limit(500));
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: S.business.timezone });
      rows = data.filter((r) => f.format(new Date(r.created_at)) === st.day);
      paint();
    } catch (e) { mount(body, h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'Offline'), 'Sales history needs a connection. ' + errText(e))); }
  }
  function paint() {
    let list = rows;
    if (st.q) list = list.filter((r) => [r.no, r.guest_name, r.table_no, r.cashier_name].join(' ').toLowerCase().includes(st.q));
    const paid = list.filter((r) => r.status === 'paid');
    const total = paid.reduce((a, r) => a + Number(r.total), 0);
    mount(body, h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Sales'), h('b', { class: 'num' }, money(total))), h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Orders'), h('b', { class: 'num' }, paid.length))),
      list.length ? h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Receipt', 'Time', 'Type', 'Payment', 'Total', ''].map((x, k) => h('th', { class: k === 4 ? 'r' : '' }, x)))),
        h('tbody', null, list.map((r) => h('tr', null, h('td', null, h('b', null, r.no), r.status === 'void' ? h('span', { class: 'tag red', style: null }, ' void') : null, h('div', { class: 'muted' }, r.cashier_name)),
          h('td', { class: 'num' }, dt(r.created_at, { timeStyle: 'short' })), h('td', null, channelLabel(r.channel) + (r.table_no ? ' · ' + r.table_no : '')), h('td', null, methodLabel(r.method)),
          h('td', { class: 'r num' }, money(r.total)), h('td', { class: 'r' }, h('button', { class: 'btn sm', onclick: () => open(r) }, 'Open'))))))) :
        h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'No sales'), 'Nothing recorded for this day.'));
  }
  function open(r) {
    const sale = { ...r, items: r.sale_items };
    const node = receiptNode(sale);
    const m = openModal('Receipt', h('div', null, node, h('div', { class: 'row end gap' },
      isManager() && r.status === 'paid' ? h('button', { class: 'btn danger', onclick: async () => { const why = await promptBox('Void sale', 'Reason (required)', 'Void sale'); if (!why) return; try { await rpc('void_sale', { p_id: r.id, p_reason: why }); m.close(); toast('Sale voided and stock restored'); load(); } catch (e) { toast(errText(e), 'error'); } } }, 'Void') : null,
      h('button', { class: 'btn primary', onclick: () => printReceipt(node) }, icon('print', 18), 'Print'))));
  }
  offs.push(on('remote-sale', debounce(load, 800)), on('sale-synced', debounce(load, 800)));
  await load();
  return () => offs.forEach((f) => f());
}
