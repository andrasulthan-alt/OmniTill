import { h, mount, money, num, toast, errText, openModal, busy, field, dt, debounce } from '../util.js';
import { icon } from '../icons.js';
import { S, on } from '../state.js';
import { rpc, run, loadIngredients } from '../api.js';

export async function render(view) {
  const offs = [];
  const st = { q: '', low: false };
  const body = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search ingredients', 'aria-label': 'Search ingredients', oninput: debounce((e) => { st.q = e.target.value.trim().toLowerCase(); paint(); }, 120) });
  const lowBtn = h('button', { class: 'chip', 'aria-pressed': 'false', onclick: (e) => { st.low = !st.low; e.currentTarget.setAttribute('aria-pressed', String(st.low)); paint(); } }, 'Low stock only');
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Stock'), h('button', { class: 'btn primary', onclick: () => editIngredient() }, icon('plus', 18), 'New ingredient')),
    h('div', { class: 'toolbar' }, search, lowBtn), body);

  async function load() { try { await loadIngredients(); } catch (e) { toast(errText(e), 'error'); } paint(); }
  const isLow = (i) => Number(i.stock) <= Number(i.min_stock);

  function paint() {
    let list = S.ingredients.filter((i) => i.active);
    const lowN = list.filter(isLow).length;
    if (st.q) list = list.filter((i) => i.name.toLowerCase().includes(st.q));
    if (st.low) list = list.filter(isLow);
    if (!S.ingredients.length) return mount(body, h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'No ingredients'), 'Add ingredients, then link them to menu items as recipes so stock goes down with each sale.'));
    mount(body, lowN ? h('div', { class: 'banner warn' }, h('span', null, `${lowN} ingredient${lowN === 1 ? ' is' : 's are'} at or below the minimum.`)) : null,
      h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Ingredient', 'In stock', 'Minimum', 'Cost / unit', ''].map((x, k) => h('th', { class: k > 0 && k < 4 ? 'r' : '' }, x)))),
        h('tbody', null, list.map((i) => h('tr', null,
          h('td', null, h('b', null, i.name), isLow(i) ? h('span', { class: 'tag red dot', style: null }, ' ' + (Number(i.stock) < 0 ? 'negative' : 'low')) : null),
          h('td', { class: 'r num' }, `${num(i.stock, 2)} ${i.unit}`), h('td', { class: 'r num muted' }, num(i.min_stock, 2)), h('td', { class: 'r num muted' }, money(i.unit_cost)),
          h('td', { class: 'r' }, h('div', { class: 'row gap end', style: null }, h('button', { class: 'btn sm', onclick: () => adjust(i) }, 'Adjust'), h('button', { class: 'btn sm', onclick: () => history(i) }, 'History'), h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + i.name, onclick: () => editIngredient(i) }, icon('edit', 18))))))))));
  }

  function adjust(i) {
    let kind = 'purchase';
    const qty = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', required: true });
    const cost = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', placeholder: 'optional' });
    const note = h('input', { maxlength: 200, placeholder: 'optional' });
    const err = h('p', { class: 'form-err', role: 'alert' });
    const box = h('div'), btn = h('button', { class: 'btn primary' }, 'Save');
    const labels = { purchase: 'Received delivery', waste: 'Waste / spoiled', adjust: 'Stock count' };
    function draw() {
      mount(box, h('p', { class: 'muted num' }, `${i.name}: ${num(i.stock, 2)} ${i.unit} now`),
        h('div', { class: 'seg', role: 'group' }, Object.entries(labels).map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: () => { kind = k; draw(); } }, l))), h('div', { style: null }, ''),
        field(kind === 'adjust' ? `Counted quantity (${i.unit})` : `Quantity (${i.unit})`, qty, kind === 'adjust' ? 'Stock is set to this number. The difference is recorded.' : null),
        kind === 'purchase' ? field('New cost per unit', cost) : null, field('Note', note), err);
    }
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try { await rpc('stock_adjust', { p_ingredient: i.id, p_kind: kind, p_qty: Number(qty.value), p_note: note.value, p_unit_cost: kind === 'purchase' && cost.value !== '' ? Number(cost.value) : null }); await loadIngredients(); paint(); m.close(); toast('Stock updated', 'ok'); }
      catch (ex) { err.textContent = errText(ex); }
    }); } }, box, h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal('Adjust stock', form); draw();
  }

  async function history(i) {
    const box = h('div', null, h('p', { class: 'muted' }, 'Loading'));
    openModal(`History · ${i.name}`, box, { wide: true });
    try {
      const rows = await run(S.sb.from('stock_moves').select('*').eq('ingredient_id', i.id).order('created_at', { ascending: false }).limit(100));
      mount(box, rows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['When', 'Type', 'Change', 'Balance', 'Note'].map((x, k) => h('th', { class: k === 2 || k === 3 ? 'r' : '' }, x)))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', { class: 'num' }, dt(r.created_at)), h('td', null, h('span', { class: 'tag' }, r.kind)), h('td', { class: 'r num' }, (Number(r.qty) > 0 ? '+' : '') + num(r.qty, 2)), h('td', { class: 'r num' }, num(r.balance_after, 2)), h('td', { class: 'muted' }, r.note)))))) : h('div', { class: 'empty' }, 'No movements yet.'));
    } catch (e) { mount(box, h('p', { class: 'form-err' }, errText(e))); }
  }

  function editIngredient(i) {
    const name = h('input', { required: true, maxlength: 80, value: i?.name || '' }), unit = h('input', { required: true, maxlength: 12, value: i?.unit || 'pcs' });
    const stock = h('input', { type: 'number', step: 'any', value: 0, disabled: !!i }), min = h('input', { type: 'number', min: 0, step: 'any', value: i?.min_stock ?? 0 });
    const cost = h('input', { type: 'number', min: 0, step: 'any', value: i?.unit_cost ?? 0 });
    const err = h('p', { class: 'form-err', role: 'alert' }), btn = h('button', { class: 'btn primary' }, 'Save');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try {
        if (i) await run(S.sb.from('ingredients').update({ name: name.value.trim(), unit: unit.value.trim(), min_stock: Number(min.value), unit_cost: Number(cost.value) }).eq('id', i.id));
        else await run(S.sb.from('ingredients').insert({ name: name.value.trim(), unit: unit.value.trim(), stock: Number(stock.value) || 0, min_stock: Number(min.value), unit_cost: Number(cost.value) }));
        await loadIngredients(); paint(); m.close(); toast('Saved', 'ok');
      } catch (ex) { err.textContent = errText(ex); }
    }); } },
    field('Name', name), h('div', { class: 'grid2' }, field('Unit', unit), field(i ? 'Stock (use Adjust to change)' : 'Opening stock', stock)), h('div', { class: 'grid2' }, field('Minimum', min), field('Cost per unit', cost)), err,
    h('div', { class: 'row end gap' }, i ? h('button', { type: 'button', class: 'btn danger', onclick: async () => { try { await run(S.sb.from('ingredients').update({ active: false }).eq('id', i.id)); await loadIngredients(); paint(); m.close(); toast('Ingredient hidden'); } catch (ex) { err.textContent = errText(ex); } } }, 'Hide') : null, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal(i ? 'Edit ingredient' : 'New ingredient', form);
  }

  offs.push(on('remote-stock', debounce(load, 800)));
  await load();
  return () => offs.forEach((f) => f());
}
