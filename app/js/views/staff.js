import { h, mount, toast, errText, busy, dt, openModal, confirmBox } from '../util.js';
import { S } from '../state.js';
import { run } from '../api.js';

const ROLES = [['pending', 'Pending'], ['cashier', 'Cashier'], ['manager', 'Manager'], ['admin', 'Admin']];

export async function render(view) {
  const body = h('div'); const st = { tab: 'staff' };
  const seg = h('div', { class: 'seg' });
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Staff'), seg), body);
  const drawSeg = () => mount(seg, [['staff', 'People'], ['audit', 'Audit log']].map(([k, l]) => h('button', { 'aria-pressed': String(st.tab === k), onclick: () => { st.tab = k; drawSeg(); load(); } }, l)));
  drawSeg();
  async function load() {
    mount(body, h('p', { class: 'mono' }, 'Loading'));
    try {
      if (st.tab === 'staff') {
        const rows = await run(S.sb.from('profiles').select('*').order('created_at'));
        const wait = rows.filter((r) => r.role === 'pending' && r.active).length;
        mount(body, wait ? h('div', { class: 'banner warn' }, h('span', null, `${wait} account${wait === 1 ? ' is' : 's are'} waiting for a role.`)) : null,
          h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['Person', 'Role', 'Active', 'Joined'].map((x) => h('th', null, x)))),
            h('tbody', null, rows.map((r) => {
              const me = r.id === S.profile.id;
              const sel = h('select', { 'aria-label': 'Role for ' + r.full_name, disabled: me, onchange: async (e) => { try { await run(S.sb.from('profiles').update({ role: e.target.value }).eq('id', r.id)); toast('Role updated', 'ok'); load(); } catch (ex) { toast(errText(ex), 'error'); load(); } } }, ROLES.map(([k, l]) => h('option', { value: k, selected: r.role === k }, l)));
              const act = h('input', { type: 'checkbox', checked: r.active, disabled: me, 'aria-label': 'Active', onchange: async (e) => { try { await run(S.sb.from('profiles').update({ active: e.target.checked }).eq('id', r.id)); toast(e.target.checked ? 'Account enabled' : 'Account disabled'); load(); } catch (ex) { toast(errText(ex), 'error'); load(); } } });
              sel.style.minWidth = '130px';
              return h('tr', null, h('td', null, h('b', null, r.full_name || '—'), me ? h('span', { class: 'tag', style: null }, ' you') : null, h('div', { class: 'muted' }, r.email)), h('td', null, sel), h('td', null, act), h('td', { class: 'num muted' }, dt(r.created_at, { dateStyle: 'medium' })));
            })))));
      } else {
        const rows = await run(S.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(200));
        mount(body, rows.length ? h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['When', 'Action', 'Reference', 'Detail'].map((x) => h('th', null, x)))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', { class: 'num' }, dt(r.at)), h('td', null, h('span', { class: 'tag' }, r.action)), h('td', { class: 'muted' }, (r.ref || '').slice(0, 12)), h('td', { class: 'muted' }, JSON.stringify(r.detail).slice(0, 120))))))) : h('div', { class: 'empty' }, 'Nothing logged yet.'));
      }
    } catch (e) { mount(body, h('div', { class: 'empty' }, errText(e))); }
  }
  load();
}
