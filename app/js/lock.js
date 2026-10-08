// Device PIN lock. The PIN never leaves this device and is never stored: only a salted PBKDF2 hash.
// Account security is the Supabase login; this screen guards a signed-in device that is left alone.
import { h, mount, openModal, toast } from './util.js';
import { icon } from './icons.js';

const KEY = 'ot.lock';
const enc = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));

async function derive(pin, saltHex) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 210000 }, k, 256));
}
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export function lockCfg() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage blocked */ } }
export const hasPin = () => !!lockCfg()?.hash;
export const clearPin = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export async function setPin(pin, duress, opts = {}) {
  const old = lockCfg() || {};
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const c = { salt, hash: await derive(pin, salt), idle: opts.idle ?? old.idle ?? 2, scramble: opts.scramble ?? old.scramble ?? true, fails: 0, until: 0 };
  if (duress) { c.dsalt = hex(crypto.getRandomValues(new Uint8Array(16))); c.dhash = await derive(duress, c.dsalt); }
  save(c);
}
export function setLockOptions(o) { const c = lockCfg(); if (c) save({ ...c, ...o }); }
export async function setDuress(pin) {
  const c = lockCfg(); if (!c) return;
  if (!pin) { delete c.dsalt; delete c.dhash; save(c); return; }
  c.dsalt = hex(crypto.getRandomValues(new Uint8Array(16))); c.dhash = await derive(pin, c.dsalt); save(c);
}
export async function checkPin(pin) {
  const c = lockCfg(); if (!c) return 'ok';
  const now = Date.now();
  if (c.until && now < c.until) return { wait: Math.ceil((c.until - now) / 1000) };
  const h1 = await derive(pin, c.salt);
  if (same(h1, c.hash)) { save({ ...c, fails: 0, until: 0 }); return 'ok'; }
  if (c.dhash && same(await derive(pin, c.dsalt), c.dhash)) return 'duress';
  const fails = (c.fails || 0) + 1;
  const until = fails >= 5 ? now + Math.min(300, 15 * 2 ** (fails - 5)) * 1000 : 0;   // 15s, 30s, 60s ... up to 5 min
  save({ ...c, fails, until });
  return fails >= 12 ? 'wipe' : { wrong: true, left: Math.max(0, 5 - fails), wait: until ? Math.ceil((until - now) / 1000) : 0 };
}

// ---- keypad UI ------------------------------------------------------------
function keypad({ scramble, onDigit, onBack, onOk }) {
  let digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  if (scramble) for (let i = digits.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [digits[i], digits[j]] = [digits[j], digits[i]]; }
  const key = (d) => h('button', { type: 'button', class: 'key', onclick: () => onDigit(d), 'aria-label': d }, d);
  return h('div', { class: 'keypad' },
    digits.slice(0, 9).map(key),
    h('button', { type: 'button', class: 'key ghost', onclick: onBack, 'aria-label': 'Delete' }, icon('back', 20)),
    key(digits[9]),
    h('button', { type: 'button', class: 'key go', onclick: onOk, 'aria-label': 'Unlock' }, icon('check', 20)));
}

// Full-screen lock. Resolves 'ok' or 'duress' or 'wipe'.
export function showLock(name) {
  return new Promise((resolve) => {
    const root = document.getElementById('lock') || h('div', { id: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Locked' });
    if (!root.parentNode) document.body.append(root);
    document.body.classList.add('is-locked');
    let pin = '';
    const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
    const msg = h('p', { class: 'lock-msg', role: 'status' }, '');
    const paint = () => mount(dots, Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
    const finish = (r) => { root.remove(); document.body.classList.remove('is-locked'); document.removeEventListener('keydown', onKey); resolve(r); };
    const submit = async () => {
      if (pin.length < 4) return;
      const p = pin; pin = ''; paint();
      const r = await checkPin(p);
      if (r === 'ok' || r === 'duress' || r === 'wipe') return finish(r);
      msg.textContent = r.wrong ? (r.wait ? `Wrong PIN. Try again in ${r.wait}s.` : `Wrong PIN. ${r.left} tries before a delay.`) : `Too many tries. Wait ${r.wait}s.`;
      draw();
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key) && pin.length < 8) { pin += e.key; paint(); }
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
      else if (e.key === 'Enter') submit();
    };
    function draw() {
      const c = lockCfg();
      mount(root, h('div', { class: 'lock-card' },
        h('div', { class: 'lock-mark' }, icon('lock', 22)),
        h('h1', { class: 'dot' }, 'LOCKED'),
        h('p', { class: 'muted' }, name ? `Enter PIN, ${name}` : 'Enter PIN'),
        dots, msg,
        keypad({ scramble: c?.scramble !== false, onDigit: (d) => { if (pin.length < 8) { pin += d; paint(); } }, onBack: () => { pin = pin.slice(0, -1); paint(); }, onOk: submit })));
      paint();
    }
    draw();
    document.addEventListener('keydown', onKey);
  });
}

// Dialog to create / change the PIN
export function pinSetupDialog({ onDone }) {
  const mk = (id, label, ph) => h('input', { id, type: 'password', inputmode: 'numeric', autocomplete: 'off', pattern: '[0-9]*', minlength: 4, maxlength: 8, placeholder: ph || '4 to 8 digits' });
  const a = mk('pin-a', 'PIN'), b = mk('pin-b', 'Repeat'), d = mk('pin-d', 'Duress');
  const err = h('p', { class: 'form-err', role: 'alert' });
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!/^\d{4,8}$/.test(a.value)) return (err.textContent = 'PIN must be 4 to 8 digits.');
      if (a.value !== b.value) return (err.textContent = 'The two PINs do not match.');
      if (d.value && (!/^\d{4,8}$/.test(d.value) || d.value === a.value)) return (err.textContent = 'Duress PIN must be 4 to 8 digits and different from the PIN.');
      await setPin(a.value, d.value || null);
      m.close(); toast('PIN saved', 'ok'); onDone && onDone();
    },
  },
  h('label', { class: 'field' }, h('span', null, 'New PIN'), a),
  h('label', { class: 'field' }, h('span', null, 'Repeat PIN'), b),
  h('label', { class: 'field' }, h('span', null, 'Duress PIN (optional)'), d,
    h('small', null, 'Typing this on the lock screen signs the device out and clears its cached data, with no warning shown. Use it if you are forced to unlock.')),
  err, h('div', { class: 'row end gap' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary' }, 'Save PIN')));
  const m = openModal('Device PIN', form);
}
