import { h, mount, money, num, toast, errText, openModal, busy, field, today, addDays, dshort, dt, download, csvCell, confirmBox } from '../util.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import { rpc, run } from '../api.js';
import { methodLabel, channelLabel } from '../receipt.js';

export async function render(view) {
  const st = { preset: 'today', from: today(), to: today() };
  const body = h('div');
  const from = h('input', { type: 'date', value: st.from, 'aria-label': 'From', onchange: (e) => { st.from = e.target.value; st.preset = 'custom'; load(); } });
  const to = h('input', { type: 'date', value: st.to, 'aria-label': 'To', onchange: (e) => { st.to = e.target.value; st.preset = 'custom'; load(); } });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Range' });
  const presets = { today: ['Today', () => [today(), today()]], week: ['7 days', () => [addDays(today(), -6), today()]], month: ['30 days', () => [addDays(today(), -29), today()]], mtd: ['This month', () => [today().slice(0, 8) + '01', today()]] };
  function drawSeg() { mount(seg, Object.entries(presets).map(([k, [l]]) => h('button', { 'aria-pressed': String(st.preset === k), onclick: () => { st.preset = k; [st.from, st.to] = presets[k][1](); from.value = st.from; to.value = st.to; drawSeg(); load(); } }, l))); }
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Reports'), h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: addExpense }, 'Add expense'), h('button', { class: 'btn', onclick: exportCsv }, 'Export CSV'))),
    h('div', { class: 'toolbar' }, seg, from, to), body);
  from.style.maxWidth = to.style.maxWidth = '170px';
  drawSeg();

  let data = null;
  async function load() {
    if (!st.from || !st.to || st.to < st.from) return mount(body, h('p', { class: 'form-err' }, 'Choose a valid date range.'));
    mount(body, h('p', { class: 'mono' }, 'Loading'));
    try {
      data = await rpc('report_summary', { p_from: st.from, p_to: st.to });
      const exp = await run(S.sb.from('expenses').select('*').gte('spent_on', st.from).lte('spent_on', st.to).order('spent_on', { ascending: false }));
      paint(exp);
    } catch (e) { mount(body, h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'Offline'), errText(e))); }
  }
  function paint(exp) {
    const d = data, t = d.totals, max = Math.max(1, ...d.by_day.map((x) => Number(x.total)));
    const stat = (l, v, red) => h('div', { class: 'stat' }, h('span', { class: 'label' }, l), h('b', { class: 'num' + (red ? ' red' : '') }, v));
    const bars = (rows, label, val, sub) => rows.length ? rows.map((r) => { const m = Math.max(...rows.map((x) => Number(val(x)))) || 1; return h('div', { class: 'col', style: null }, h('div', { class: 'row between' }, h('span', null, label(r)), h('b', { class: 'num' }, sub(r))), h('div', { class: 'hbar' }, h('i', { }))); }) : [h('p', { class: 'muted' }, 'No data')];
    const hbars = (rows, label, val, sub) => {
      if (!rows.length) return h('p', { class: 'muted' }, 'No data');
      const m = Math.max(...rows.map((x) => Number(val(x)))) || 1;
      return rows.map((r) => { const i = h('i'); i.style.width = (Number(val(r)) / m * 100) + '%'; return h('div', { class: 'col', style: null }, h('div', { class: 'row between' }, h('span', null, label(r)), h('b', { class: 'num' }, sub(r))), h('div', { class: 'hbar' }, i)); });
    };
    mount(body,
      h('div', { class: 'stats' }, stat('Revenue', money(d.revenue)), stat('Orders', num(t.orders)), stat('Average order', money(t.orders ? Number(t.total) / t.orders : 0)),
        stat('Cost of goods', money(d.cogs)), stat('Expenses', money(d.expenses)), stat('Profit', money(d.profit), Number(d.profit) < 0)),
      Number(d.room_revenue) ? h('p', { class: 'muted' }, `Revenue includes ${money(d.room_revenue)} from room nights (checked out in this period).`) : null,
      d.low_stock ? h('div', { class: 'banner warn' }, h('span', null, `${d.low_stock} ingredient${d.low_stock === 1 ? '' : 's'} low on stock.`), h('a', { class: 'btn sm', href: '#/stock' }, 'Open stock')) : null,
      h('div', { class: 'card' }, h('h3', null, 'Sales by day'), d.by_day.length ? h('div', { class: 'bars', role: 'img', 'aria-label': 'Sales by day' }, d.by_day.map((x) => { const i = h('i', { title: `${x.day}: ${money(x.total)}` }); i.style.height = Math.max(2, Number(x.total) / max * 100) + '%'; return h('div', null, i, h('small', null, dshort(x.day))); })) : h('p', { class: 'muted' }, 'No sales in this period.')),
      h('div', { class: 'sep' }),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h3', null, 'Top items'), hbars(d.top_products, (r) => r.name, (r) => r.qty, (r) => `${num(r.qty)} sold`)),
        h('div', { class: 'card' }, h('h3', null, 'Payment methods'), hbars(d.by_method, (r) => methodLabel(r.method), (r) => r.total, (r) => money(r.total)), h('div', { class: 'sep' }), h('h3', null, 'Order types'), hbars(d.by_channel, (r) => channelLabel(r.channel), (r) => r.total, (r) => money(r.total)))),
      h('div', { class: 'sep' }),
      h('div', { class: 'card flush scroll-x' }, h('div', { class: 'row between', style: null }, h('h3', { style: null }, 'Expenses')), exp.length ? h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Date', 'Category', 'Note', 'Amount', ''].map((x, k) => h('th', { class: k === 3 ? 'r' : '' }, x)))),
        h('tbody', null, exp.map((x) => h('tr', null, h('td', { class: 'num' }, x.spent_on), h('td', null, x.category), h('td', { class: 'muted' }, x.note), h('td', { class: 'r num' }, money(x.amount)),
          h('td', { class: 'r' }, h('button', { class: 'icon-btn', 'aria-label': 'Delete expense', onclick: async () => { if (await confirmBox('Delete expense?', `${x.category}: ${money(x.amount)}`, 'Delete', true)) { try { await run(S.sb.from('expenses').delete().eq('id', x.id)); load(); } catch (e) { toast(errText(e), 'error'); } } } }, icon('trash', 18))))))) : h('div', { class: 'empty' }, 'No expenses recorded in this period.')));
    body.querySelectorAll('.card.flush > .row').forEach((r) => { r.style.padding = '14px 14px 0'; });
  }

  function addExpense() {
    const date = h('input', { type: 'date', required: true, value: today() }), cat = h('input', { required: true, maxlength: 40, list: 'exp-cats', value: 'Supplies' });
    const dl = h('datalist', { id: 'exp-cats' }, ['Supplies', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Marketing', 'Other'].map((x) => h('option', { value: x })));
    const amount = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', required: true }), note = h('input', { maxlength: 200 });
    const err = h('p', { class: 'form-err', role: 'alert' }), btn = h('button', { class: 'btn primary' }, 'Save');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try { await run(S.sb.from('expenses').insert({ spent_on: date.value, category: cat.value.trim(), amount: Number(amount.value), note: note.value.trim() })); m.close(); toast('Expense saved', 'ok'); load(); } catch (ex) { err.textContent = errText(ex); }
    }); } }, h('div', { class: 'grid2' }, field('Date', date), field('Amount', amount)), field('Category', cat), dl, field('Note', note), err,
    h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal('Add expense', form);
  }

  async function exportCsv(e) {
    await busy(e.currentTarget, async () => {
      try {
        const tz = S.business.timezone;
        const rows = await run(S.sb.from('sales').select('no,created_at,channel,table_no,guest_name,method,subtotal,discount,service,tax,total,status,cashier_name,sale_items(name,qty,price)')
          .gte('created_at', `${addDays(st.from, -1)}T00:00:00Z`).lte('created_at', `${addDays(st.to, 1)}T23:59:59Z`).order('created_at').limit(5000));
        const day = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(v));
        const inR = rows.filter((r) => day(r.created_at) >= st.from && day(r.created_at) <= st.to);
        const head = ['receipt', 'date_time', 'type', 'table', 'guest', 'payment', 'subtotal', 'discount', 'service', 'tax', 'total', 'status', 'cashier', 'items'];
        const lines = [head.join(',')].concat(inR.map((r) => [r.no, r.created_at, r.channel, r.table_no, r.guest_name, r.method, r.subtotal, r.discount, r.service, r.tax, r.total, r.status, r.cashier_name,
          r.sale_items.map((i) => `${i.qty}x ${i.name}`).join('; ')].map(csvCell).join(',')));
        download(`omnitill-sales-${st.from}_${st.to}.csv`, lines.join('\r\n'));
        toast(`${inR.length} sales exported`, 'ok');
      } catch (er) { toast(errText(er), 'error'); }
    });
  }
  load();
}
