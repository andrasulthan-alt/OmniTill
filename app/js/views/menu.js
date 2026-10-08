import { h, mount, money, toast, errText, openModal, busy, field, num, debounce } from '../util.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import { run, loadCatalog, loadIngredients } from '../api.js';
import { photo, photoField } from '../images.js';

export async function render(view) {
  const st = { cat: null };
  const body = h('div');
  mount(view, h('div', { class: 'page-h' }, h('h1', null, 'Menu'), h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => editCategory() }, 'New category'), h('button', { class: 'btn primary', onclick: () => editProduct() }, icon('plus', 18), 'New item'))), body);
  await loadIngredients().catch(() => {});

  const refresh = async () => { await loadCatalog(); paint(); };
  function paint() {
    const cats = [...S.categories].sort((a, b) => (a.area === b.area ? a.sort - b.sort : a.area.localeCompare(b.area)));
    let list = S.products.filter((p) => !st.cat || p.category_id === st.cat);
    mount(body,
      h('div', { class: 'tabs' }, h('button', { class: 'chip', 'aria-pressed': String(!st.cat), onclick: () => { st.cat = null; paint(); } }, 'All'),
        cats.map((c) => h('button', { class: 'chip', 'aria-pressed': String(st.cat === c.id), ondblclick: () => editCategory(c), onclick: () => { st.cat = c.id; paint(); } }, c.name))),
      st.cat ? h('p', null, h('button', { class: 'btn sm', onclick: () => editCategory(S.categories.find((c) => c.id === st.cat)) }, 'Edit this category')) : null,
      list.length ? h('div', { class: 'card flush scroll-x' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Item', 'Category', 'Price', 'Status', ''].map((x, k) => h('th', { class: k === 2 ? 'r' : '' }, x)))),
        h('tbody', null, list.map((p) => h('tr', null, h('td', null, h('span', { class: 'row gap' }, photo(p.image_url, '', 'mini'), h('b', null, p.name)), p.popular ? h('span', { class: 'red' }, ' •') : null), h('td', { class: 'muted' }, S.categories.find((c) => c.id === p.category_id)?.name || ''),
          h('td', { class: 'r num' }, money(p.price)), h('td', null, h('span', { class: 'tag dot ' + (p.active ? '' : 'red') }, p.active ? 'On menu' : 'Hidden')),
          h('td', { class: 'r' }, h('button', { class: 'btn sm', onclick: () => editProduct(p) }, 'Edit'))))))) :
        h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'Empty'), 'No items here yet.'));
  }

  function editCategory(c) {
    const name = h('input', { required: true, maxlength: 40, value: c?.name || '' });
    const area = h('select', null, [['cafe', 'Cafe'], ['hotel', 'Hotel services']].map(([k, l]) => h('option', { value: k, selected: (c?.area || 'cafe') === k }, l)));
    const sort = h('input', { type: 'number', value: c?.sort ?? 0 });
    const err = h('p', { class: 'form-err', role: 'alert' }), btn = h('button', { class: 'btn primary' }, 'Save');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try {
        if (c) await run(S.sb.from('categories').update({ name: name.value.trim(), area: area.value, sort: Number(sort.value) }).eq('id', c.id));
        else { const id = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'cat-' + Date.now(); await run(S.sb.from('categories').insert({ id, name: name.value.trim(), area: area.value, sort: Number(sort.value) })); }
        await refresh(); m.close(); toast('Saved', 'ok');
      } catch (ex) { err.textContent = errText(ex); }
    }); } }, field('Name', name), h('div', { class: 'grid2' }, field('Area', area), field('Order', sort)), err,
    h('div', { class: 'row end gap' }, c ? h('button', { type: 'button', class: 'btn danger', onclick: async () => { try { await run(S.sb.from('categories').delete().eq('id', c.id)); st.cat = null; await refresh(); m.close(); toast('Category deleted'); } catch (ex) { err.textContent = /foreign key|violates/i.test(ex.message) ? 'This category still has items. Move or hide them first.' : errText(ex); } } }, 'Delete') : null, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal(c ? 'Edit category' : 'New category', form);
  }

  async function editProduct(p) {
    if (!S.categories.length) return toast('Create a category first', 'error');
    const name = h('input', { required: true, maxlength: 80, value: p?.name || '' });
    const cat = h('select', { required: true }, S.categories.map((c) => h('option', { value: c.id, selected: p ? p.category_id === c.id : st.cat === c.id }, `${c.name} (${c.area})`)));
    const price = h('input', { type: 'number', min: 0, step: 'any', inputmode: 'decimal', required: true, value: p?.price ?? '' });
    const pic = photoField(p?.image_url);
    const popular = h('input', { type: 'checkbox', checked: !!p?.popular }), active = h('input', { type: 'checkbox', checked: p ? p.active : true });
    let recipe = [];
    if (p) { try { recipe = (await run(S.sb.from('recipes').select('ingredient_id, qty').eq('product_id', p.id))).map((r) => ({ id: r.ingredient_id, qty: Number(r.qty) })); } catch { /* ignore */ } }
    const rbox = h('div');
    function drawRecipe() {
      const ing = S.ingredients.filter((i) => i.active);
      mount(rbox, h('h3', { class: 'label' }, 'Recipe (taken from stock per sale)'),
        recipe.map((r, k) => h('div', { class: 'row gap', style: null },
          h('select', { onchange: (e) => { r.id = e.target.value; } }, ing.map((i) => h('option', { value: i.id, selected: i.id === r.id }, `${i.name} (${i.unit})`))),
          h('input', { type: 'number', min: 0, step: 'any', value: r.qty, 'aria-label': 'Quantity', oninput: (e) => { r.qty = Number(e.target.value); } }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { recipe.splice(k, 1); drawRecipe(); } }, icon('x', 18)))),
        ing.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => { recipe.push({ id: ing[0].id, qty: 1 }); drawRecipe(); } }, 'Add ingredient') : h('p', { class: 'muted' }, 'Add ingredients under Stock first.'));
      rbox.querySelectorAll('.row.gap').forEach((r) => { const s = r.querySelector('select'); if (s) s.style.flex = '2'; const i = r.querySelector('input'); if (i) i.style.maxWidth = '110px'; });
    }
    const err = h('p', { class: 'form-err', role: 'alert' }), btn = h('button', { class: 'btn primary' }, 'Save');
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try {
        const row = { name: name.value.trim(), category_id: cat.value, price: Number(price.value), popular: popular.checked, active: active.checked };
        let id = p?.id;
        if (p) { if (pic.changed()) row.image_url = await pic.save('products', id); await run(S.sb.from('products').update(row).eq('id', id)); }
        else {
          id = (await run(S.sb.from('products').insert(row).select('id').single())).id;
          if (pic.changed()) await run(S.sb.from('products').update({ image_url: await pic.save('products', id) }).eq('id', id));
        }
        const clean = recipe.filter((r) => r.id && r.qty > 0);
        const merged = new Map(); clean.forEach((r) => merged.set(r.id, (merged.get(r.id) || 0) + r.qty));
        await run(S.sb.from('recipes').delete().eq('product_id', id));
        if (merged.size) await run(S.sb.from('recipes').insert([...merged].map(([ingredient_id, qty]) => ({ product_id: id, ingredient_id, qty }))));
        await refresh(); m.close(); toast('Saved', 'ok');
      } catch (ex) { err.textContent = errText(ex); }
    }); } },
    field('Name', name), h('div', { class: 'grid2' }, field('Category', cat), field('Price', price)), pic.el,
    h('label', { class: 'row gap', style: null }, popular, h('span', null, 'Popular (shown first)')), h('div', { style: null }, ''), h('label', { class: 'row gap' }, active, h('span', null, 'On the menu')),
    h('div', { class: 'sep' }), rbox, err, h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), btn));
    const m = openModal(p ? 'Edit item' : 'New item', form, { wide: true }); drawRecipe();
  }

  paint();
}
