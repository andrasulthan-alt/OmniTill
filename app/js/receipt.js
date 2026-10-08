import { h, money, dt } from './util.js';
import { S } from './state.js';

const LABELS = { cash: 'Cash', qris: 'QRIS', card: 'Card', transfer: 'Transfer', room_charge: 'Room charge' };
const CH = { dine_in: 'Dine in', takeaway: 'Takeaway', room: 'Room' };
export const methodLabel = (m) => LABELS[m] || m;
export const channelLabel = (c) => CH[c] || c;

// sale: {no, created_at, channel, table_no, guest_name, items:[{name, price, qty}], subtotal, discount, service, tax, total, method, paid, change, cashier_name, status}
export function receiptNode(sale, note) {
  const b = S.business;
  const ln = (a, c, cls) => h('div', { class: 'ln' + (cls ? ' ' + cls : '') }, h('span', null, a), h('span', null, c));
  return h('div', { class: 'receipt' },
    h('h3', null, b.name),
    b.address ? h('div', { class: 'c' }, b.address) : null,
    b.phone ? h('div', { class: 'c' }, b.phone) : null,
    h('hr'),
    ln('No', sale.no), ln('Date', dt(sale.created_at)),
    sale.cashier_name ? ln('Cashier', sale.cashier_name) : null,
    ln('Type', channelLabel(sale.channel) + (sale.table_no ? ' · ' + sale.table_no : '')),
    sale.guest_name ? ln('Guest', sale.guest_name) : null,
    h('hr'),
    sale.items.map((i) => h('div', null, h('div', null, i.name), ln(`${i.qty} × ${money(i.price)}`, money(i.qty * i.price)))),
    h('hr'),
    ln('Subtotal', money(sale.subtotal)),
    Number(sale.discount) ? ln('Discount', '-' + money(sale.discount)) : null,
    Number(sale.service) ? ln('Service', money(sale.service)) : null,
    Number(sale.tax) ? ln('Tax', money(sale.tax)) : null,
    ln('TOTAL', money(sale.total), 'strong'),
    ln(methodLabel(sale.method), sale.method === 'room_charge' ? 'on room bill' : money(sale.paid)),
    Number(sale.change) ? ln('Change', money(sale.change)) : null,
    sale.status === 'void' ? h('div', { class: 'c red' }, 'VOID' + (sale.void_reason ? ': ' + sale.void_reason : '')) : null,
    h('hr'),
    h('div', { class: 'c' }, b.receipt_footer || ''),
    note ? h('div', { class: 'c' }, note) : null);
}
export function printReceipt(node) {
  const area = document.getElementById('print-area');
  area.replaceChildren(node.cloneNode(true));
  if (window.OmniTillAndroid && window.OmniTillAndroid.printPage) window.OmniTillAndroid.printPage(); else window.print();
}
