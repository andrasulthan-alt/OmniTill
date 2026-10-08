// Small helpers: DOM builder (no innerHTML, so user text can never become markup),
// money/date formatting, toasts and modals.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'readOnly') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const mount = (el, ...kids) => { clear(el); add(el, kids); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---- format ---------------------------------------------------------------
let fmtCfg = { currency: 'IDR', locale: 'id-ID', tz: 'Asia/Jakarta' };
export const setFormat = (c) => { fmtCfg = { ...fmtCfg, ...c }; moneyFmt = null; };
let moneyFmt = null;
export function money(n) {
  if (!moneyFmt) {
    const d = ['IDR', 'JPY', 'KRW', 'VND', 'CLP'].includes(fmtCfg.currency) ? 0 : 2;
    try { moneyFmt = new Intl.NumberFormat(fmtCfg.locale, { style: 'currency', currency: fmtCfg.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch { moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }); }
  }
  return moneyFmt.format(Number(n) || 0);
}
export const num = (n, d = 0) => new Intl.NumberFormat(fmtCfg.locale, { maximumFractionDigits: d }).format(Number(n) || 0);
export function dt(v, opts) {
  if (!v) return '';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: fmtCfg.tz, ...(opts || { dateStyle: 'medium', timeStyle: 'short' }) }).format(new Date(v)); }
  catch { return String(v); }
}
// "today" as YYYY-MM-DD in the business time zone
export function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: fmtCfg.tz }).format(d); } catch { return d.toISOString().slice(0, 10); }
}
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const nights = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
export const dshort = (iso) => dt(iso + 'T00:00:00Z', { timeZone: 'UTC', day: '2-digit', month: 'short' });

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export function receiptNo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const r = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 5).toUpperCase();
  return `OT-${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${r}`;
}
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const cls = (...a) => a.filter(Boolean).join(' ');

// ---- toast ----------------------------------------------------------------
export function toast(msg, kind = 'info', ms = 3200) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}
export function errText(e) {
  const m = (e && (e.message || e.msg || e.error_description)) || String(e || 'Something went wrong');
  return m.replace(/^.*ERROR:\s*/, '').slice(0, 240);
}

// ---- modal ----------------------------------------------------------------
// openModal(title, bodyNode, { wide, onClose }) -> { close, el }
export function openModal(title, body, opts = {}) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); opts.onClose && opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape' && !opts.locked) close(); };
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h2', null, title), opts.locked ? null : h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal-body' }, body));
  const back = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === back && !opts.locked) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  const f = box.querySelector('input,select,textarea,button.primary'); if (f && !opts.noFocus) f.focus();
  return { close, el: box };
}
export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; m.close(); res(v); } };
    const m = openModal(title, h('div', null, h('p', { class: 'muted' }, text),
      h('div', { class: 'row end gap' }, h('button', { class: 'btn', onclick: () => fin(false) }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => fin(true) }, okLabel))), { onClose: () => fin(false) });
  });
}
// asks for one line of text (e.g. a void reason)
export function promptBox(title, label, okLabel = 'Save', opts = {}) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; m.close(); res(v); } };
    const inp = h('input', { type: opts.type || 'text', required: true, placeholder: opts.placeholder || '', value: opts.value || '', inputmode: opts.inputmode });
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) fin(v); } },
      h('label', { class: 'field' }, h('span', null, label), inp),
      h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => fin(null) }, 'Cancel'), h('button', { class: 'btn primary' }, okLabel)));
    const m = openModal(title, form, { onClose: () => fin(null) });
  });
}

// ---- busy button helper ------------------------------------------------
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', null, hint) : null);
}
export function download(name, text, type = 'text/csv') {
  if (window.OmniTillAndroid && window.OmniTillAndroid.saveFile) {      // inside the Android app a WebView cannot download blobs
    if (window.OmniTillAndroid.saveFile(name, type, text)) return;
  }
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
