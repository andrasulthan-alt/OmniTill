import { h, mount, $, toast, errText, openModal, busy, field, confirmBox, dt } from './util.js';
import { icon } from './icons.js';
import { S, on, emit, role, can, isManager } from './state.js';
import { initClient, signIn, signUp, signOut, loadProfile, loadCatalog } from './api.js';
import { startLive, stopLive, flush, refreshCounts, rejectedSales, retryRejected, discardSale } from './sync.js';
import { wipeCache } from './store.js';
import { hasPin, showLock, lockCfg, pinSetupDialog } from './lock.js';
import config from './config.js';

const root = document.getElementById('app');
const CFG_KEY = 'ot.cfg';

// ---- theme ----------------------------------------------------------------
export function applyTheme() {
  let t = null; try { t = localStorage.getItem('ot.theme'); } catch { /* ignore */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0c0c0d' : '#f2f2f0');
}
export function setTheme(t) { try { t ? localStorage.setItem('ot.theme', t) : localStorage.removeItem('ot.theme'); } catch { /* ignore */ } applyTheme(); }

// ---- config ---------------------------------------------------------------
function loadCfg() {
  if (config.url && config.anonKey) return { url: config.url.replace(/\/+$/, ''), anonKey: config.anonKey };
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (c?.url && c?.anonKey) return c; } catch { /* ignore */ }
  return null;
}
export const cfgFromConfigFile = () => !!(config.url && config.anonKey);

function showSetup(msg) {
  const url = h('input', { type: 'url', required: true, placeholder: 'https://xxxx.supabase.co', autocomplete: 'off', spellcheck: 'false' });
  const key = h('input', { type: 'text', required: true, placeholder: 'anon / publishable key', autocomplete: 'off', spellcheck: 'false' });
  const err = h('p', { class: 'form-err', role: 'alert' }, msg || '');
  mount(root, h('div', { class: 'center' }, h('form', { class: 'auth', onsubmit: (e) => {
    e.preventDefault();
    let u; try { u = new URL(url.value.trim()); } catch { return (err.textContent = 'That is not a valid URL.'); }
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return (err.textContent = 'Use the https:// address of your Supabase project.');
    const k = key.value.trim();
    if (/service_role/i.test(atobSafe(k.split('.')[1] || ''))) return (err.textContent = 'That is a service_role key. Never use it in an app. Use the anon (public) key.');
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ url: u.origin, anonKey: k })); } catch { return (err.textContent = 'Storage is blocked in this browser.'); }
    boot();
  } },
  h('span', { class: 'brand' }, 'OMNI', h('i', null, 'TILL')),
  h('h2', null, 'Connect to your database'),
  h('p', { class: 'muted' }, 'Paste the Project URL and the anon (public) key from Supabase: Project settings, API. See the README for the one-time setup.'),
  field('Project URL', url), field('Anon key', key), err,
  h('button', { class: 'btn primary block' }, 'Connect'))));
}
function atobSafe(s) { try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } }

// ---- sign in / sign up ----------------------------------------------------
function showAuth(note) {
  let mode = 'in';
  const view = () => {
    const email = h('input', { type: 'email', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const pass = h('input', { type: 'password', required: true, minlength: 8, autocomplete: mode === 'in' ? 'current-password' : 'new-password' });
    const name = h('input', { type: 'text', required: true, autocomplete: 'name', maxlength: 60 });
    const err = h('p', { class: 'form-err', role: 'alert' }, note || '');
    const btn = h('button', { class: 'btn primary block' }, mode === 'in' ? 'Sign in' : 'Create account');
    const form = h('form', { class: 'auth', onsubmit: (e) => {
      e.preventDefault(); err.textContent = '';
      busy(btn, async () => {
        try {
          if (mode === 'in') await signIn(email.value, pass.value);
          else { const d = await signUp(email.value, pass.value, name.value); if (!d.session) { mode = 'in'; note = 'Account created. Confirm your email, then sign in.'; return mount(root, h('div', { class: 'center' }, view())); } }
          await enter();
        } catch (ex) { err.textContent = /invalid login/i.test(ex.message) ? 'Wrong email or password.' : errText(ex); }
      });
    } },
    h('span', { class: 'brand' }, 'OMNI', h('i', null, 'TILL')),
    h('h2', null, mode === 'in' ? 'Sign in to continue' : 'Create your account'),
    mode === 'up' ? field('Your name', name) : null,
    field('Email', email), field(mode === 'in' ? 'Password' : 'Password (8+ characters)', pass), err, btn,
    h('p', { class: 'muted', style: null }, ''),
    h('div', { class: 'row between' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; note = ''; mount(root, h('div', { class: 'center' }, view())); } },
        mode === 'in' ? 'Create account' : 'I have an account'),
      cfgFromConfigFile() ? null : h('button', { type: 'button', class: 'btn sm', onclick: () => { try { localStorage.removeItem(CFG_KEY); } catch { /* ignore */ } boot(); } }, 'Change database')),
    mode === 'up' ? h('p', { class: 'faint', }, 'The first account becomes the admin. Later accounts wait for the admin to approve them.') : null);
    return form;
  };
  mount(root, h('div', { class: 'center' }, view()));
}

function showPending() {
  const t = setInterval(async () => { try { await loadProfile(); if (S.profile?.active && S.profile.role !== 'pending') { clearInterval(t); enter(); } } catch { /* offline */ } }, 8000);
  mount(root, h('div', { class: 'center' }, h('div', { class: 'auth' },
    h('span', { class: 'brand' }, 'OMNI', h('i', null, 'TILL')),
    h('h2', null, S.profile && !S.profile.active ? 'Account disabled' : 'Waiting for approval'),
    h('p', { class: 'muted' }, S.profile && !S.profile.active ? 'An admin turned this account off. Ask them to switch it back on.' : `You are signed in as ${S.session.user.email}. An admin must approve your account and give it a role. This page updates by itself.`),
    h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: async () => { await loadProfile().catch(() => {}); if (S.profile?.active && S.profile.role !== 'pending') { clearInterval(t); enter(); } else toast('Still waiting'); } }, 'Check again'),
      h('button', { class: 'btn', onclick: async () => { clearInterval(t); await signOut(); showAuth(); } }, 'Sign out')))));
}

// ---- entering the app -----------------------------------------------------
async function enter() {
  mount(root, h('div', { class: 'center' }, h('p', { class: 'mono' }, 'Loading')));
  let prof;
  try { prof = await loadProfile(); }
  catch (e) { return fatal('Could not read your profile: ' + errText(e) + '. If this is a new project, run supabase/schema.sql in the SQL Editor.'); }
  if (!prof) return fatal('Your account has no profile row. Run supabase/schema.sql in the Supabase SQL Editor, then sign out and sign in again.');
  if (!prof.active || prof.role === 'pending') return showPending();
  if (hasPin()) { const r = await showLock(prof.full_name); if (r !== 'ok') return panic(); }
  try { await loadCatalog(); } catch (e) { return fatal('Could not load data: ' + errText(e)); }
  await refreshCounts();
  stopLive(); startLive(); flush();
  renderShell();
  armIdle();
  if (!hasPin() && !sessionStorage.getItem('ot.pinask')) { sessionStorage.setItem('ot.pinask', '1'); offerPin(); }
}
function fatal(msg) {
  mount(root, h('div', { class: 'center' }, h('div', { class: 'auth' }, h('span', { class: 'brand' }, 'OMNI', h('i', null, 'TILL')), h('p', { class: 'form-err' }, msg),
    h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => location.reload() }, 'Retry'), h('button', { class: 'btn', onclick: async () => { await signOut(); showAuth(); } }, 'Sign out')))));
}
// Duress PIN or too many wrong PINs: drop the session and local cache silently. Unsent sales stay on the device.
async function panic() { stopLive(); await signOut(); await wipeCache(); try { localStorage.removeItem('ot.lock'); } catch { /* ignore */ } showAuth(); }

function offerPin() {
  const m = openModal('Protect this device', h('div', null,
    h('p', { class: 'muted' }, 'Set a PIN so nobody can use the till if you walk away. It locks the screen after a few idle minutes.'),
    h('div', { class: 'row end gap' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Not now'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); pinSetupDialog({ onDone: armIdle }); } }, 'Set PIN'))));
}

// ---- idle lock ------------------------------------------------------------
let idleT, locking = false;
export async function lockNow() {
  if (!hasPin() || locking) return;
  locking = true;
  const r = await showLock(S.profile?.full_name);
  locking = false;
  if (r !== 'ok') return panic();
  armIdle();
}
function armIdle() {
  clearTimeout(idleT);
  const c = lockCfg(); if (!c?.hash || !c.idle) return;
  idleT = setTimeout(lockNow, c.idle * 60000);
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { if (!locking && S.profile) armIdle(); }, { passive: true }));
export const rearmIdle = armIdle;

// ---- shell + router ---------------------------------------------------------
const ROUTES = [
  { id: 'sell', label: 'Sell', icon: 'sale', roles: ['cashier', 'manager', 'admin'], load: () => import('./views/sell.js') },
  { id: 'hotel', label: 'Hotel', icon: 'bed', roles: ['cashier', 'manager', 'admin'], hotel: true, load: () => import('./views/hotel.js') },
  { id: 'stock', label: 'Stock', icon: 'box', roles: ['manager', 'admin'], load: () => import('./views/stock.js') },
  { id: 'reports', label: 'Reports', icon: 'chart', roles: ['manager', 'admin'], load: () => import('./views/reports.js') },
  { id: 'menu', label: 'Menu', icon: 'menu', roles: ['manager', 'admin'], sec: true, load: () => import('./views/menu.js') },
  { id: 'history', label: 'Sales', icon: 'receipt', roles: ['cashier', 'manager', 'admin'], sec: true, load: () => import('./views/history.js') },
  { id: 'staff', label: 'Staff', icon: 'users', roles: ['admin'], sec: true, load: () => import('./views/staff.js') },
  { id: 'settings', label: 'Settings', icon: 'gear', roles: ['cashier', 'manager', 'admin'], sec: true, load: () => import('./views/settings.js') },
];
const allowed = () => ROUTES.filter((r) => r.roles.includes(role()) && (!r.hotel || S.business.hotel_enabled));
let cleanup = null, view, navEl, statusEl;

function renderShell() {
  const items = allowed();
  navEl = h('nav', { class: 'nav', 'aria-label': 'Main' },
    items.map((r) => h('a', { href: '#/' + r.id, dataset: { id: r.id }, class: r.sec ? 'sec' : '' }, icon(r.icon, 22), h('span', null, r.label))),
    h('a', { href: '#/more', dataset: { id: 'more' }, class: 'more-only' }, icon('list', 22), h('span', null, 'More')));
  statusEl = h('button', { class: 'status', onclick: openSyncPanel, 'aria-label': 'Sync status' });
  view = h('main', { id: 'view', tabindex: '-1' });
  mount(root, h('div', { class: 'shell' }, navEl, h('div', { class: 'col-main' },
    h('header', { class: 'top' }, h('span', { class: 'brand' }, 'OMNI', h('i', null, 'TILL')), h('span', { class: 'grow' }), statusEl,
      hasPin() ? h('button', { class: 'icon-btn', 'aria-label': 'Lock now', onclick: lockNow }, icon('lock', 20)) : null),
    view)));
  paintStatus();
  route();
}
function paintStatus() {
  if (!statusEl) return;
  const n = S.outbox + S.rejected;
  statusEl.className = 'status' + (S.online && !S.rejected ? '' : ' off');
  mount(statusEl, h('i'), S.rejected ? `${S.rejected} need attention` : !S.online ? (n ? `Offline · ${n} queued` : 'Offline') : n ? `Syncing ${n}` : 'Online');
}
on('sync', paintStatus);
on('catalog', () => { paintStatus(); });
on('sale-rejected', (d) => toast('A sale could not be saved on the server: ' + d.message, 'error', 6000));
on('signedout', () => { if (S.profile) { S.profile = null; stopLive(); showAuth('You were signed out.'); } });

async function openSyncPanel() {
  const rej = await rejectedSales();
  const body = h('div', null,
    h('div', { class: 'list-item' }, h('span', null, 'Connection'), h('span', { class: 'tag dot' }, S.online ? 'Online' : 'Offline')),
    h('div', { class: 'list-item' }, h('span', null, 'Waiting to send'), h('b', { class: 'num' }, S.outbox)),
    h('div', { class: 'list-item' }, h('span', null, 'Last sync'), h('span', { class: 'muted' }, S.lastSync ? dt(S.lastSync) : '—')),
    rej.length ? h('div', null, h('div', { class: 'sep' }), h('h3', { class: 'label' }, 'Rejected by the server'),
      rej.map((r) => h('div', { class: 'card', style: null }, h('div', { class: 'row between' }, h('b', null, r.no), h('span', { class: 'muted num' }, dt(r.created))),
        h('p', { class: 'form-err' }, r.rejected),
        h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onclick: async () => { await retryRejected(r.id); m.close(); openSyncPanel(); } }, 'Retry'),
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Discard this sale?', 'The sale will be removed from this device and never reach the database.', 'Discard', true)) { await discardSale(r.id); m.close(); openSyncPanel(); } } }, 'Discard'))))) : null,
    h('div', { class: 'row end gap' }, h('button', { class: 'btn', onclick: async (e) => { await busy(e.currentTarget, async () => { await loadCatalog().catch(() => {}); await flush(); }); m.close(); openSyncPanel(); } }, icon('refresh', 16), 'Sync now')));
  const m = openModal('Sync', body);
}

let current = null;
async function route() {
  if (!view) return;
  const id = (location.hash.replace(/^#\/?/, '').split('/')[0]) || (allowed()[0]?.id || 'settings');
  navEl.querySelectorAll('a').forEach((a) => (a.dataset.id === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  if (id === 'more') { cleanup = null; return mount(view, moreView()); }
  const r = allowed().find((x) => x.id === id);
  if (!r) { location.hash = '#/' + (allowed()[0]?.id || 'settings'); return; }
  current = id;
  mount(view, h('p', { class: 'mono' }, 'Loading'));
  try {
    const mod = await r.load();
    if (current !== id) return;
    mount(view);
    cleanup = (await mod.render(view, { go: (x) => { location.hash = '#/' + x; } })) || null;
  } catch (e) { console.error(e); mount(view, h('div', { class: 'empty' }, h('div', { class: 'dot' }, 'Error'), errText(e))); }
  view.focus({ preventScroll: true });
}
function moreView() {
  return h('div', null, h('div', { class: 'page-h' }, h('h1', null, 'More')),
    h('div', { class: 'card flush' }, allowed().filter((r) => r.sec).map((r) =>
      h('a', { class: 'list-item', href: '#/' + r.id, style: null, 'data-x': '' }, h('span', { class: 'row gap' }, icon(r.icon, 20), r.label), icon('arrow', 18)))));
}
window.addEventListener('hashchange', () => { if (S.profile) route(); });

export function rerouteAfterRoleChange() { renderShell(); }
export async function logout() { stopLive(); await signOut(); sessionStorage.removeItem('ot.pinask'); showAuth(); }

// ---- boot -----------------------------------------------------------------
async function boot() {
  applyTheme();
  const cfg = loadCfg();
  if (!cfg) return showSetup();
  try { initClient(cfg); } catch (e) { return showSetup('Could not start: ' + errText(e)); }
  const { data } = await S.sb.auth.getSession();
  S.session = data.session;
  if (!S.session) return showAuth();
  await enter();
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
