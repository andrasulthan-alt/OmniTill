import { h, mount, toast, errText, busy, field, openModal, confirmBox } from '../util.js';
import { icon } from '../icons.js';
import { S, can } from '../state.js';
import { run, applyBusiness, loadCatalog } from '../api.js';
import { hasPin, lockCfg, pinSetupDialog, clearPin, setLockOptions, setDuress, checkPin } from '../lock.js';
import { logout, setTheme, rearmIdle, rerouteAfterRoleChange } from '../app.js';
import { lockNow } from '../app.js';

export async function render(view) {
  const body = h('div');
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Settings')), body);
  const refresh = () => paint();

  function paint() {
    const c = lockCfg();
    let theme = null; try { theme = localStorage.getItem('ot.theme'); } catch { /* ignore */ }
    mount(body,
      h('div', { class: 'card' }, h('h3', null, 'Account'),
        h('div', { class: 'list-item' }, h('span', null, S.profile.full_name || S.session.user.email, h('div', { class: 'muted' }, S.session.user.email)), h('span', { class: 'tag solid' }, S.profile.role)),
        h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: logout }, icon('logout', 18), 'Sign out'))),
      h('div', { class: 'sep' }),
      h('div', { class: 'card' }, h('h3', null, 'This device'),
        h('div', { class: 'list-item' }, h('span', null, 'Appearance'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, [[null, 'Auto'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => h('button', { 'aria-pressed': String((theme || null) === k), onclick: () => { setTheme(k); paint(); } }, l)))),
        h('div', { class: 'list-item' }, h('span', null, 'PIN lock', h('div', { class: 'muted' }, hasPin() ? 'On. The screen locks when idle.' : 'Off. Anyone holding this device can use it.')),
          h('div', { class: 'row gap' }, hasPin() ? h('button', { class: 'btn sm', onclick: lockNow }, 'Lock now') : null, h('button', { class: 'btn sm', onclick: () => pinSetupDialog({ onDone: () => { rearmIdle(); rerouteAfterRoleChange(); } }) }, hasPin() ? 'Change' : 'Set PIN'))),
        hasPin() ? h('div', null,
          h('div', { class: 'list-item' }, h('span', null, 'Lock after'), h('select', { 'aria-label': 'Idle minutes', onchange: (e) => { setLockOptions({ idle: Number(e.target.value) }); rearmIdle(); toast('Saved'); } },
            [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [15, '15 minutes'], [0, 'Never']].map(([v, l]) => h('option', { value: v, selected: (c.idle ?? 2) === v }, l)))),
          h('div', { class: 'list-item' }, h('span', null, 'Scrambled keypad', h('div', { class: 'muted' }, 'Digits move around every time, so smudges and shoulder surfing reveal less.')), h('input', { type: 'checkbox', checked: c.scramble !== false, 'aria-label': 'Scrambled keypad', onchange: (e) => { setLockOptions({ scramble: e.target.checked }); toast('Saved'); } })),
          h('div', { class: 'list-item' }, h('span', null, 'Duress PIN', h('div', { class: 'muted' }, c.dhash ? 'Set. Typing it signs this device out and clears cached data.' : 'Not set.')),
            h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onclick: () => duress() }, c.dhash ? 'Change' : 'Set'), c.dhash ? h('button', { class: 'btn sm', onclick: async () => { await setDuress(null); paint(); } }, 'Remove') : null)),
          h('div', { class: 'list-item' }, h('span', null, 'Remove PIN'), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Remove the PIN?', 'This device will no longer lock itself.', 'Remove', true)) { clearPin(); rearmIdle(); rerouteAfterRoleChange(); } } }, 'Remove'))) : null),
      can('admin') ? h('div', null, h('div', { class: 'sep' }), businessCard()) : null,
      h('div', { class: 'sep' }),
      h('div', { class: 'card' }, h('h3', null, 'About'), h('p', { class: 'muted' }, 'OmniTill is free software. Data lives in your own Supabase project. The code never sends it anywhere else.'),
        h('div', { class: 'list-item' }, h('span', null, 'Database'), h('span', { class: 'muted' }, S.cfg?.url?.replace(/^https?:\/\//, ''))),
        h('div', { class: 'list-item' }, h('span', null, 'Version'), h('span', { class: 'muted num' }, '1.0.0'))));
  }

  function duress() {
    const a = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', minlength: 4, maxlength: 8, required: true }), err = h('p', { class: 'form-err', role: 'alert' });
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); if (!/^\d{4,8}$/.test(a.value)) return (err.textContent = 'Use 4 to 8 digits.'); const same = await checkPin(a.value); if (same === 'ok') return (err.textContent = 'It must differ from your normal PIN.'); await setDuress(a.value); m.close(); paint(); toast('Duress PIN saved', 'ok'); } },
      h('p', { class: 'muted' }, 'If someone forces you to unlock the till, type this PIN instead. It signs the device out and clears its cached data, without any warning on screen.'), field('Duress PIN', a), err,
      h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save')));
    const m = openModal('Duress PIN', form);
  }

  function businessCard() {
    const b = S.business;
    const f = (k, o) => h('input', { value: b[k] ?? '', ...(o || {}) });
    const name = f('name', { required: true, maxlength: 60 }), addr = f('address', { maxlength: 200 }), phone = f('phone', { maxlength: 40 }), foot = f('receipt_footer', { maxlength: 160 });
    const cur = f('currency', { maxlength: 3, required: true }), loc = f('locale', { maxlength: 20 }), tz = f('timezone', { maxlength: 40 });
    const tax = h('input', { type: 'number', min: 0, max: 100, step: 'any', value: b.tax_rate }), svc = h('input', { type: 'number', min: 0, max: 100, step: 'any', value: b.service_rate });
    const hotel = h('input', { type: 'checkbox', checked: b.hotel_enabled });
    const err = h('p', { class: 'form-err', role: 'alert' }), btn = h('button', { class: 'btn primary' }, 'Save business settings');
    return h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try {
        try { new Intl.DateTimeFormat('en', { timeZone: tz.value }); new Intl.NumberFormat(loc.value || 'en', { style: 'currency', currency: cur.value.toUpperCase() }); } catch { return (err.textContent = 'Check the time zone (like Asia/Jakarta), locale (like id-ID) and 3-letter currency.'); }
        await run(S.sb.from('business').update({ name: name.value.trim(), address: addr.value.trim(), phone: phone.value.trim(), receipt_footer: foot.value.trim(), currency: cur.value.toUpperCase(), locale: loc.value.trim() || 'en-US', timezone: tz.value.trim(), tax_rate: Number(tax.value) || 0, service_rate: Number(svc.value) || 0, hotel_enabled: hotel.checked }).eq('id', 1));
        await loadCatalog(); err.textContent = ''; toast('Saved', 'ok'); location.hash = '#/settings'; paint();
      } catch (ex) { err.textContent = errText(ex); }
    }); } }, h('h3', null, 'Business'),
    field('Business name', name), h('div', { class: 'grid2' }, field('Address', addr), field('Phone', phone)), field('Receipt footer', foot),
    h('div', { class: 'grid2' }, field('Currency (ISO)', cur), field('Locale', loc)), field('Time zone', tz),
    h('div', { class: 'grid2' }, field('Tax %', tax), field('Service charge %', svc)),
    h('label', { class: 'row gap' }, hotel, h('span', null, 'Hotel features (rooms, bookings, room charges)')), h('div', { class: 'sep' }), err, btn);
  }
  paint();
}
