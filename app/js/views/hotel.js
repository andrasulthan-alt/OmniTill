import { h, mount, money, toast, errText, openModal, busy, field, today, addDays, nights, dshort, confirmBox, promptBox } from '../util.js';
import { icon } from '../icons.js';
import { S, on, can, isManager } from '../state.js';
import { rpc, run, reloadBookings, reloadRooms } from '../api.js';
import { methodLabel } from '../receipt.js';

const HK = { clean: 'Clean', dirty: 'Dirty', maintenance: 'Maintenance' };

export async function render(view, { go }) {
  const offs = [];
  const grid = h('div', { class: 'rooms' });
  const list = h('div');
  const t0 = () => today();

  mount(view,
    h('div', { class: 'page-h' }, h('h1', null, 'Hotel'),
      h('div', { class: 'row gap' }, isManager() ? h('button', { class: 'btn', onclick: manageRooms }, 'Rooms') : null,
        h('button', { class: 'btn primary', onclick: () => newBooking() }, icon('plus', 18), 'New booking'))),
    grid, h('div', { class: 'sep' }), h('h3', { class: 'label' }, 'Reservations and stays'), h('div', { style: null }), list);

  const bookingsOf = (roomId) => S.bookings.filter((b) => b.room_id === roomId).sort((a, b) => a.check_in.localeCompare(b.check_in));
  function stateOf(room) {
    const bs = bookingsOf(room.id), now = t0();
    const stay = bs.find((b) => b.status === 'checked_in');
    const arriving = bs.find((b) => b.status === 'reserved' && b.check_in <= now);
    const next = bs.find((b) => b.status === 'reserved');
    return { stay, arriving, next };
  }

  function paint() {
    const rooms = S.rooms.filter((r) => r.active);
    if (!rooms.length) mount(grid, h('div', { class: 'empty', style: null }, h('div', { class: 'dot' }, 'No rooms'), isManager() ? 'Add rooms with the Rooms button.' : 'A manager needs to add rooms.'));
    else mount(grid, rooms.map((r) => {
      const { stay, arriving, next } = stateOf(r);
      return h('button', { class: 'room ' + (stay ? 'occupied' : '') + (r.housekeeping === 'maintenance' ? ' maintenance' : ''), onclick: () => roomDialog(r), 'aria-label': `Room ${r.number}` },
        h('div', { class: 'row between' }, h('span', { class: 'no' }, r.number), h('span', { class: 'mono' }, r.type)),
        h('div', { class: 'col', style: null },
          stay ? h('b', null, stay.guest_name) : arriving ? h('b', null, arriving.guest_name) : h('span', { class: 'muted' }, 'Vacant'),
          h('span', { class: 'mono' }, stay ? `Until ${dshort(stay.check_out)}` : arriving ? 'Arriving today' : next ? `Next ${dshort(next.check_in)}` : money(r.rate) + ' / night')),
        h('span', { class: 'tag ' + (r.housekeeping === 'clean' ? '' : 'red') }, HK[r.housekeeping]));
    }));
    const bs = [...S.bookings].sort((a, b) => a.check_in.localeCompare(b.check_in));
    mount(list, bs.length ? h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Room', 'Guest', 'Dates', 'Status', ''].map((x) => h('th', null, x)))),
      h('tbody', null, bs.map((b) => h('tr', null,
        h('td', null, h('b', null, b.rooms?.number ?? '')), h('td', null, b.guest_name, b.guest_phone ? h('div', { class: 'muted num' }, b.guest_phone) : null),
        h('td', { class: 'num' }, `${dshort(b.check_in)} → ${dshort(b.check_out)} · ${nights(b.check_in, b.check_out)}n`),
        h('td', null, h('span', { class: 'tag dot ' + (b.status === 'checked_in' ? 'solid' : '') }, b.status === 'checked_in' ? 'In house' : 'Reserved')),
        h('td', { class: 'r' }, h('button', { class: 'btn sm', onclick: () => bookingDialog(b) }, 'Open'))))))) :
      h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'No bookings'), 'Reservations and guests in the house appear here.'));
  }

  function roomDialog(room) {
    const { stay, arriving, next } = stateOf(room);
    const b = stay || arriving;
    const hkBtns = ['clean', 'dirty', 'maintenance'].filter((k) => k !== room.housekeeping && (k !== 'maintenance' || isManager())).map((k) =>
      h('button', { class: 'btn sm', onclick: async (e) => busy(e.currentTarget, async () => { try { await rpc('room_set_housekeeping', { p_room: room.id, p_state: k }); await reloadRooms(); m.close(); toast(`Room ${room.number} marked ${HK[k].toLowerCase()}`); } catch (er) { toast(errText(er), 'error'); } }) }, 'Mark ' + HK[k].toLowerCase()));
    const m = openModal(`Room ${room.number}`, h('div', null,
      h('div', { class: 'row gap wrap' }, h('span', { class: 'tag' }, room.type), h('span', { class: 'tag' }, `Sleeps ${room.capacity}`), h('span', { class: 'tag' }, money(room.rate) + ' / night'), h('span', { class: 'tag ' + (room.housekeeping === 'clean' ? '' : 'red') }, HK[room.housekeeping])),
      h('div', { class: 'sep' }),
      b ? h('div', null, h('h3', { class: 'label' }, stay ? 'Current guest' : 'Arriving today'), h('p', null, h('b', null, b.guest_name), ` · ${dshort(b.check_in)} → ${dshort(b.check_out)}`),
        h('div', { class: 'row gap wrap' }, h('button', { class: 'btn primary', onclick: () => { m.close(); bookingDialog(b); } }, stay ? 'Bill and check out' : 'Check in'),
          stay ? h('button', { class: 'btn', onclick: () => { S.pendingRoom = b.id; m.close(); go('sell'); } }, 'Charge to room') : null))
        : h('div', null, h('p', { class: 'muted' }, next ? `Next reservation: ${next.guest_name}, ${dshort(next.check_in)}.` : 'No guest right now.'),
          h('button', { class: 'btn primary', onclick: () => { m.close(); newBooking(room.id); } }, 'Book this room')),
      h('div', { class: 'sep' }), h('h3', { class: 'label' }, 'Housekeeping'), h('div', { class: 'row gap wrap' }, hkBtns)));
  }

  async function bookingDialog(b) {
    const body = h('div', null, h('p', { class: 'muted' }, 'Loading bill'));
    const m = openModal(`Room ${b.rooms?.number ?? ''} · ${b.guest_name}`, body, { wide: true });
    const info = h('div', { class: 'row gap wrap' }, h('span', { class: 'tag' }, `${dshort(b.check_in)} → ${dshort(b.check_out)}`), h('span', { class: 'tag' }, `${b.guests} guest${b.guests > 1 ? 's' : ''}`), b.guest_phone ? h('span', { class: 'tag num' }, b.guest_phone) : null);
    let folio = null;
    try { folio = await rpc('booking_folio', { p_id: b.id }); } catch (e) { return mount(body, h('p', { class: 'form-err' }, errText(e))); }
    const ln = (a, c, cls) => h('div', { class: 'sum ' + (cls || '') }, h('span', null, a), h('b', { class: 'num' }, c));
    const bill = h('div', { class: 'card' }, ln(`Room, ${folio.nights} night${folio.nights === 1 ? '' : 's'} × ${money(folio.rate)}`, money(folio.room_total)),
      folio.charges.map((c) => ln(`Charge ${c.no}`, money(c.total))), Number(folio.deposit) ? ln('Deposit paid', '-' + money(folio.deposit)) : null, ln('Balance due', money(folio.due), 'total'));
    const acts = h('div', { class: 'row end gap' });
    if (b.status === 'reserved') {
      acts.append(h('button', { class: 'btn danger', onclick: async () => { const why = await promptBox('Cancel reservation', 'Reason', 'Cancel booking'); if (!why) return;
        try { await rpc('booking_cancel', { p_id: b.id, p_reason: why }); await reloadBookings(); m.close(); toast('Reservation cancelled'); } catch (e) { toast(errText(e), 'error'); } } }, 'Cancel booking'),
        h('button', { class: 'btn primary', onclick: (e) => busy(e.currentTarget, async () => { try { await rpc('booking_check_in', { p_id: b.id }); await reloadBookings(); m.close(); toast('Checked in', 'ok'); } catch (er) { toast(errText(er), 'error'); } }) }, 'Check in'));
    } else if (b.status === 'checked_in') {
      acts.append(h('button', { class: 'btn', onclick: () => { S.pendingRoom = b.id; m.close(); go('sell'); } }, 'Charge to room'), h('button', { class: 'btn primary', onclick: () => { m.close(); checkOut(b, folio); } }, 'Check out'));
    }
    mount(body, info, h('div', { class: 'sep' }), bill, acts);
  }

  function checkOut(b, folio) {
    let method = 'cash';
    const due = Number(folio.due);
    const recv = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: Math.max(due, 0) });
    const body = h('div'), err = h('p', { class: 'form-err', role: 'alert' });
    const go2 = h('button', { class: 'btn primary block' }, due > 0 ? 'Take payment and check out' : 'Check out');
    function draw() {
      mount(body, h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('span', { class: 'label' }, due >= 0 ? 'Balance due' : 'Refund to guest'), h('b', { class: 'num' }, money(Math.abs(due))))),
        due > 0 ? h('div', null, h('div', { class: 'pay-methods' }, ['cash', 'qris', 'card', 'transfer'].map((k) => h('button', { 'aria-pressed': String(method === k), onclick: () => { method = k; draw(); } }, methodLabel(k)))), field('Amount received', recv)) : null, err, go2);
    }
    go2.onclick = () => busy(go2, async () => {
      try { const r = await rpc('booking_check_out', { p_id: b.id, p_method: method, p_paid: due > 0 ? Number(recv.value) : 0 }); await reloadBookings(); await reloadRooms(); m.close(); toast(r.refund > 0 ? `Checked out. Refund ${money(r.refund)}` : 'Checked out', 'ok'); }
      catch (e) { err.textContent = errText(e); }
    });
    const m = openModal('Check out', body); draw();
  }

  function newBooking(roomId) {
    const rooms = S.rooms.filter((r) => r.active && r.housekeeping !== 'maintenance');
    const room = h('select', { required: true }, h('option', { value: '' }, 'Choose a room'), rooms.map((r) => h('option', { value: r.id, selected: r.id === roomId }, `${r.number} · ${r.type} · sleeps ${r.capacity}`)));
    const guest = h('input', { required: true, maxlength: 80, autocomplete: 'off' });
    const phone = h('input', { type: 'tel', maxlength: 40, autocomplete: 'off' });
    const guests = h('input', { type: 'number', min: 1, value: 1, required: true });
    const ci = h('input', { type: 'date', required: true, value: t0() });
    const co = h('input', { type: 'date', required: true, value: addDays(t0(), 1) });
    const rate = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', required: true });
    const dep = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: 0 });
    const note = h('input', { maxlength: 300 });
    const sum = h('p', { class: 'muted num' });
    const err = h('p', { class: 'form-err', role: 'alert' });
    const upd = () => {
      const r = S.rooms.find((x) => x.id === room.value);
      if (r && !rate.dataset.touched) rate.value = r.rate;
      const n = ci.value && co.value ? nights(ci.value, co.value) : 0;
      sum.textContent = n > 0 ? `${n} night${n === 1 ? '' : 's'} · ${money(n * (Number(rate.value) || 0))}` : '';
    };
    [room, ci, co, rate].forEach((x) => x.addEventListener('input', upd)); rate.addEventListener('input', () => { rate.dataset.touched = '1'; });
    const btn = h('button', { class: 'btn primary' }, 'Create booking');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); err.textContent = ''; busy(btn, async () => {
      try { await rpc('booking_create', { p_room: room.value, p_guest: guest.value, p_phone: phone.value, p_guests: Number(guests.value), p_check_in: ci.value, p_check_out: co.value, p_rate: Number(rate.value), p_deposit: Number(dep.value) || 0, p_note: note.value }); await reloadBookings(); m.close(); toast('Booking created', 'ok'); }
      catch (ex) { err.textContent = errText(ex); }
    }); } },
    field('Room', room), field('Guest name', guest), h('div', { class: 'grid2' }, field('Phone', phone), field('Guests', guests)),
    h('div', { class: 'grid2' }, field('Check-in', ci), field('Check-out', co)), h('div', { class: 'grid2' }, field('Rate per night', rate), field('Deposit', dep)), field('Note', note), sum, err,
    h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal('New booking', form); upd();
  }

  function manageRooms() {
    const body = h('div');
    function draw() {
      const num = h('input', { required: true, maxlength: 10, placeholder: 'Number' }), type = h('input', { value: 'Standard', maxlength: 30 });
      const rate = h('input', { type: 'number', min: 0, step: 'any', required: true, placeholder: 'Rate' }), cap = h('input', { type: 'number', min: 1, value: 2 });
      mount(body, S.rooms.map((r) => h('div', { class: 'list-item' }, h('span', null, h('b', null, r.number), ` · ${r.type} · ${money(r.rate)}`, r.active ? '' : h('span', { class: 'tag', style: null }, ' hidden')),
        h('button', { class: 'btn sm', onclick: async () => { try { await run(S.sb.from('rooms').update({ active: !r.active }).eq('id', r.id)); await reloadRooms(); draw(); } catch (e) { toast(errText(e), 'error'); } } }, r.active ? 'Hide' : 'Show'))),
      h('div', { class: 'sep' }), h('form', { onsubmit: async (e) => { e.preventDefault(); try { await run(S.sb.from('rooms').insert({ number: num.value.trim(), type: type.value.trim() || 'Standard', rate: Number(rate.value), capacity: Number(cap.value) })); await reloadRooms(); draw(); } catch (er) { toast(errText(er), 'error'); } } },
        h('h3', { class: 'label' }, 'Add a room'), h('div', { class: 'grid2' }, field('Number', num), field('Type', type)), h('div', { class: 'grid2' }, field('Rate per night', rate), field('Sleeps', cap)), h('button', { class: 'btn primary' }, 'Add room')));
    }
    openModal('Rooms', body, { wide: true }); draw();
  }

  offs.push(on('bookings', paint), on('catalog', paint));
  paint();
  if (S.online) reloadBookings().catch(() => {});
  return () => offs.forEach((f) => f());
}
