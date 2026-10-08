import { h, mount, money, toast, errText, openModal, busy, field, debounce, today, uuid, receiptNo } from '../util.js';
import { icon } from '../icons.js';
import { S, on, can } from '../state.js';
import { rpc, loadShift, reloadBookings } from '../api.js';
import { queueSale, results } from '../sync.js';
import { totals, quickCash } from '../calc.js';
import { receiptNode, printReceipt, methodLabel } from '../receipt.js';
import { photoOrBlank } from '../images.js';

export async function render(view) {
  const st = { area: S.business.hotel_enabled ? null : 'cafe', cat: null, q: '', cart: new Map(), channel: 'dine_in', table: '', booking: null, discount: 0, dtype: 'amount', open: false };
  st.area = 'cafe';
  if (S.pendingRoom) { st.channel = 'room'; st.booking = S.pendingRoom; st.area = 'hotel'; S.pendingRoom = null; }
  const offs = [];

  const lines = () => [...st.cart.values()].map((l) => ({ ...l, price: Number(l.p.price) }));
  const calc = () => totals(lines(), { discount: st.discount, discountType: st.dtype, tax_rate: Number(S.business.tax_rate), service_rate: Number(S.business.service_rate), currency: S.business.currency });
  const count = () => [...st.cart.values()].reduce((a, l) => a + l.qty, 0);

  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Categories' });
  const grid = h('div', { class: 'products' });
  const cartBox = h('aside', { class: 'cart', 'aria-label': 'Order' });
  const fab = h('button', { class: 'cart-fab', onclick: () => { st.open = true; paintCart(); } });
  const areaSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Area' });
  const banner = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search menu', 'aria-label': 'Search menu', oninput: debounce((e) => { st.q = e.target.value.trim().toLowerCase(); paintGrid(); }, 120) });

  mount(view,
    h('div', { class: 'page-h' }, h('h1', null, 'Sell'), S.business.hotel_enabled ? areaSeg : null),
    banner,
    h('div', { class: 'pos' }, h('section', null, search, tabs, grid), cartBox), fab);

  function paintShell() {
    mount(areaSeg, [['cafe', 'Cafe'], ['hotel', 'Hotel services']].map(([k, l]) =>
      h('button', { 'aria-pressed': String(st.area === k), onclick: () => { st.area = k; st.cat = null; paintShell(); paintTabs(); paintGrid(); } }, l)));
  }
  function paintBanner() {
    mount(banner);
    if (S.shift) return;
    if (!S.online) return;
    const amount = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: 0, 'aria-label': 'Opening cash' });
    const b = h('button', { class: 'btn primary sm' }, 'Open shift');
    b.onclick = () => busy(b, async () => {
      try { await rpc('open_shift', { p_opening: Number(amount.value) || 0 }); await loadShift(); toast('Shift opened', 'ok'); paintBanner(); } catch (e) { toast(errText(e), 'error'); }
    });
    mount(banner, h('div', { class: 'banner warn' }, h('span', null, 'No open shift. Count the cash in the drawer and open one to track today’s takings.'),
      h('span', { class: 'row gap' }, h('span', { style: null }, amount), b)));
    banner.querySelector('input').style.maxWidth = '120px';
  }
  function paintTabs() {
    const cats = S.categories.filter((c) => c.area === st.area).sort((a, b) => a.sort - b.sort);
    mount(tabs, h('button', { class: 'chip', 'aria-pressed': String(!st.cat), onclick: () => { st.cat = null; paintTabs(); paintGrid(); } }, 'All'),
      cats.map((c) => h('button', { class: 'chip', 'aria-pressed': String(st.cat === c.id), onclick: () => { st.cat = c.id; paintTabs(); paintGrid(); } }, c.name)));
  }
  function paintGrid() {
    const ids = new Set(S.categories.filter((c) => c.area === st.area).map((c) => c.id));
    let list = S.products.filter((p) => p.active && ids.has(p.category_id) && (!st.cat || p.category_id === st.cat));
    if (st.q) list = list.filter((p) => p.name.toLowerCase().includes(st.q));
    list.sort((a, b) => (b.popular - a.popular) || a.sort - b.sort || a.name.localeCompare(b.name));
    if (!list.length) return mount(grid, h('div', { class: 'empty', style: null }, h('div', { class: 'dot' }, 'No items'), S.products.length ? 'Nothing matches.' : 'The menu is empty. A manager can add items under Menu.'));
    const anyImg = list.some((p) => p.image_url);
    mount(grid, list.map((p) => {
      const q = st.cart.get(p.id)?.qty || 0;
      return h('button', { class: 'product' + (anyImg ? ' has-img' : ''), onclick: () => add(p), 'aria-label': `Add ${p.name}, ${money(p.price)}` },
        photoOrBlank(p.image_url, p.name, anyImg), h('b', null, p.name, p.popular ? h('span', { class: 'red' }, ' •') : null), h('span', { class: 'row between' }, h('span', { class: 'price num' }, money(p.price)), q ? h('span', { class: 'qty num' }, q) : null));
    }));
  }
  function add(p) { const l = st.cart.get(p.id); if (l) l.qty = Math.min(999, l.qty + 1); else st.cart.set(p.id, { p, qty: 1 }); paintGrid(); paintCart(); }
  function setQty(id, d) { const l = st.cart.get(id); if (!l) return; l.qty += d; if (l.qty <= 0) st.cart.delete(id); else l.qty = Math.min(999, l.qty); paintGrid(); paintCart(); }

  function roomBookings() { return S.bookings.filter((b) => b.status === 'checked_in'); }

  function paintCart() {
    const t = calc(), n = count();
    cartBox.classList.toggle('open', st.open);
    fab.classList.toggle('empty-cart', n === 0 || st.open);
    mount(fab, h('span', null, `${n} item${n === 1 ? '' : 's'}`), h('b', { class: 'num' }, money(t.total)));
    const chSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Order type' }, [['dine_in', 'Dine in'], ['takeaway', 'Takeaway'], ...(S.business.hotel_enabled ? [['room', 'Room']] : [])].map(([k, l]) =>
      h('button', { 'aria-pressed': String(st.channel === k), onclick: () => { st.channel = k; if (k !== 'room') st.booking = null; paintCart(); } }, l)));
    const extra = st.channel === 'dine_in' ? field('Table', h('input', { value: st.table, maxlength: 20, placeholder: 'e.g. 5', oninput: (e) => { st.table = e.target.value; } }))
      : st.channel === 'room' ? field('Guest in room', h('select', { onchange: (e) => { st.booking = e.target.value || null; } },
        h('option', { value: '' }, roomBookings().length ? 'Choose a room' : 'No guest is checked in'),
        roomBookings().map((b) => h('option', { value: b.id, selected: st.booking === b.id }, `Room ${b.rooms?.number ?? '?'} · ${b.guest_name}`)))) : null;
    mount(cartBox,
      h('div', { class: 'row between' }, h('h3', { class: 'label' }, 'Order'), h('button', { class: 'icon-btn cart-close', 'aria-label': 'Close order', onclick: () => { st.open = false; paintCart(); } }, '×')),
      chSeg, h('div', { style: null }, ''), extra,
      h('div', { class: 'cart-lines' }, n === 0 ? h('div', { class: 'empty' }, 'Tap items to add them.') :
        [...st.cart.values()].map((l) => h('div', { class: 'line' },
          h('div', null, h('div', { class: 'nm' }, l.p.name), h('div', { class: 'sub num' }, `${money(l.p.price)} × ${l.qty}`)),
          h('div', { class: 'row gap' }, h('span', { class: 'stepper' }, h('button', { 'aria-label': 'Less', onclick: () => setQty(l.p.id, -1) }, icon('minus', 16)), h('span', { class: 'num' }, l.qty), h('button', { 'aria-label': 'More', onclick: () => setQty(l.p.id, 1) }, icon('plus', 16))))))),
      n ? h('div', { class: 'row gap', style: null },
        h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', placeholder: 'Discount', value: st.discount || '', 'aria-label': 'Discount', oninput: (e) => { st.discount = Math.max(0, Number(e.target.value) || 0); paintTotals(); } }),
        h('div', { class: 'seg' }, [['amount', S.business.currency], ['percent', '%']].map(([k, l]) => h('button', { 'aria-pressed': String(st.dtype === k), onclick: () => { st.dtype = k; paintCart(); } }, l)))) : null,
      totalsBox, h('div', { class: 'row gap', style: null },
        h('button', { class: 'btn', disabled: !n, onclick: () => { st.cart.clear(); st.discount = 0; paintGrid(); paintCart(); } }, 'Clear'),
        h('button', { class: 'btn primary grow', disabled: !n, onclick: pay }, 'Pay ', h('b', { class: 'num' }, money(t.total)))));
    paintTotals();
    cartBox.querySelectorAll('.row.gap').forEach((r) => { if (r.querySelector('input[type=number]')) r.querySelector('input').style.maxWidth = '50%'; });
  }
  const totalsBox = h('div', { style: null });
  function paintTotals() {
    const t = calc();
    mount(totalsBox, h('div', { class: 'sum' }, h('span', null, 'Subtotal'), h('span', { class: 'num' }, money(t.subtotal))),
      t.discount ? h('div', { class: 'sum' }, h('span', null, 'Discount'), h('span', { class: 'num' }, '-' + money(t.discount))) : null,
      t.service ? h('div', { class: 'sum' }, h('span', null, `Service ${S.business.service_rate}%`), h('span', { class: 'num' }, money(t.service))) : null,
      t.tax ? h('div', { class: 'sum' }, h('span', null, `Tax ${S.business.tax_rate}%`), h('span', { class: 'num' }, money(t.tax))) : null,
      h('div', { class: 'sum total' }, h('span', null, 'Total'), h('b', { class: 'num' }, money(t.total))));
    const payBtn = cartBox.querySelector('.btn.primary b'); if (payBtn) payBtn.textContent = money(t.total);
    mount(fab, h('span', null, `${count()} item${count() === 1 ? '' : 's'}`), h('b', { class: 'num' }, money(t.total)));
  }

  function pay() {
    if (st.channel === 'room' && !st.booking) return toast('Choose which room to charge', 'error');
    if (S.online && !S.shift) return toast('Open your shift first', 'error');
    const t = calc();
    let method = st.channel === 'room' ? 'room_charge' : 'cash';
    const recv = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: t.total, 'aria-label': 'Cash received' });
    const body = h('div');
    const err = h('p', { class: 'form-err', role: 'alert' });
    const go = h('button', { class: 'btn primary block' }, 'Confirm payment');
    const methods = st.channel === 'room' ? ['room_charge', 'cash', 'qris', 'card', 'transfer'] : ['cash', 'qris', 'card', 'transfer'];
    function draw() {
      const received = Number(recv.value) || 0;
      mount(body, h('div', { class: 'stats', style: null }, h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Total due'), h('b', { class: 'num' }, money(t.total)))),
        h('div', { class: 'pay-methods', role: 'group', 'aria-label': 'Payment method' }, methods.map((k) => h('button', { 'aria-pressed': String(method === k), onclick: () => { method = k; draw(); } }, methodLabel(k)))),
        method === 'cash' ? h('div', null, field('Cash received', recv),
          h('div', { class: 'quick' }, quickCash(t.total, S.business.currency).map((v) => h('button', { class: 'chip', onclick: () => { recv.value = v; draw(); } }, v === t.total ? 'Exact' : money(v)))),
          h('div', { class: 'sum' }, h('span', null, 'Change'), h('b', { class: 'num' }, money(Math.max(0, received - t.total))))) : null,
        method === 'room_charge' ? h('p', { class: 'muted' }, 'This is added to the guest’s room bill and paid at check-out.') : null,
        err, go);
      go.disabled = method === 'cash' && received < t.total;
    }
    recv.oninput = () => { const r = Number(recv.value) || 0; go.disabled = method === 'cash' && r < t.total; const c = body.querySelector('.sum b'); if (c) c.textContent = money(Math.max(0, r - t.total)); };
    go.onclick = () => busy(go, async () => {
      const sale = {
        id: uuid(), no: receiptNo(), channel: st.channel, method, table_no: st.channel === 'dine_in' ? st.table : '',
        booking_id: st.channel === 'room' ? st.booking : null,
        guest_name: st.channel === 'room' ? (S.bookings.find((b) => b.id === st.booking)?.guest_name || '') : '',
        discount: t.discount, paid: method === 'cash' ? Number(recv.value) : t.total,
        items: lines().map((l) => ({ product_id: l.p.id, qty: l.qty, price: l.price })),
      };
      const names = new Map(lines().map((l) => [l.p.id, l.p.name]));
      try {
        const r = await queueSale(sale);
        m.close(); st.open = false;
        const res = results.get(sale.id);
        const local = { ...sale, created_at: new Date().toISOString(), cashier_name: S.profile?.full_name, ...t, paid: sale.paid, change: Math.max(0, sale.paid - t.total) - 0,
          items: sale.items.map((i) => ({ name: names.get(i.product_id), price: i.price, qty: i.qty })), status: 'paid' };
        if (res) { local.no = res.no; local.total = Number(res.total); local.change = Number(res.change); local.paid = Number(res.paid); }
        st.cart.clear(); st.discount = 0; st.table = ''; paintGrid(); paintCart();
        showReceipt(local, r.rejected ? 'NOT SAVED ON SERVER: ' + r.rejected : res ? null : 'Saved on this device. It will upload when you are online.', r.rejected);
      } catch (e) { err.textContent = errText(e); }
    });
    const m = openModal('Payment', body); draw();
  }

  function showReceipt(sale, note, bad) {
    const node = receiptNode(sale, note);
    const m = openModal('Receipt', h('div', null, node,
      h('div', { class: 'row end gap' }, h('button', { class: 'btn', onclick: () => printReceipt(node) }, icon('print', 18), 'Print'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'New order'))), { wide: false });
    if (bad) toast('Sale rejected by the server. See the Sync panel.', 'error', 6000);
  }

  offs.push(on('catalog', () => { paintTabs(); paintGrid(); paintBanner(); paintCart(); }));
  offs.push(on('bookings', () => paintCart()));
  paintShell(); paintTabs(); paintGrid(); paintBanner(); paintCart();
  if (S.online) reloadBookings().catch(() => {});
  return () => offs.forEach((f) => f());
}
