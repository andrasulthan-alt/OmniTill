// Supabase access: client, auth, cached catalog, RPC wrappers.
import { S, emit } from './state.js';
import { kvGet, kvSet } from './store.js';
import { setFormat, errText } from './util.js';

export function initClient(cfg) {
  S.cfg = cfg;
  S.sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ot-auth' },
  });
  S.sb.auth.onAuthStateChange((ev, session) => {
    S.session = session;
    if (ev === 'SIGNED_OUT') emit('signedout');
  });
  return S.sb;
}

// True when an error means "no network / server down" rather than "the server said no".
export function isNetworkError(e) {
  if (!e) return false;
  const m = String(e.message || e);
  if (e.code && /^(P0|2|4)/.test(String(e.code)) && !/^PGRST30/.test(String(e.code))) return false;   // postgres: it answered
  if (/PGRST30|JWT|expired/i.test(m)) return true;                                                  // token needs a refresh: retry later
  if (e.status === 0 || e.status >= 500 || /Failed to fetch|NetworkError|Load failed|network|fetch|timeout|offline/i.test(m)) return true;
  return false;
}

// ---- auth -----------------------------------------------------------------
export async function signIn(email, password) {
  const { data, error } = await S.sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  S.session = data.session; return data;
}
export async function signUp(email, password, fullName) {
  const { data, error } = await S.sb.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() } } });
  if (error) throw error;
  S.session = data.session; return data;
}
export async function signOut() { try { await S.sb.auth.signOut({ scope: 'local' }); } catch { /* offline: local clear is enough */ } S.session = null; S.profile = null; }

// ---- cached catalog -------------------------------------------------------
const CACHE = 'catalog:';
async function cached(key) { const uid = S.session?.user?.id; return uid ? kvGet(CACHE + uid + ':' + key) : undefined; }
async function keep(key, v) { const uid = S.session?.user?.id; if (uid) await kvSet(CACHE + uid + ':' + key, v); }

export function applyBusiness(b) {
  if (!b) return;
  S.business = { ...S.business, ...b };
  setFormat({ currency: b.currency, locale: b.locale, tz: b.timezone });
}

export async function loadProfile() {
  const uid = S.session?.user?.id; if (!uid) return null;
  const { data, error } = await S.sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) { const c = await cached('profile'); if (c && isNetworkError(error)) { S.profile = c; return c; } throw error; }
  S.profile = data; if (data) await keep('profile', data);
  return data;
}

// Pull everything this role may see. Falls back to the device cache when offline.
export async function loadCatalog() {
  const sb = S.sb;
  const q = async (name, build) => {
    const { data, error } = await build(sb.from(name));
    if (error) throw error; return data;
  };
  try {
    const [business, categories, products, rooms, bookings] = await Promise.all([
      q('business', (t) => t.select('*').eq('id', 1).maybeSingle()),
      q('categories', (t) => t.select('*').order('sort')),
      q('products', (t) => t.select('*').order('sort').order('name')),
      q('rooms', (t) => t.select('*').order('number')),
      q('bookings', (t) => t.select('*, rooms(number)').in('status', ['reserved', 'checked_in']).order('check_in')),
    ]);
    applyBusiness(business); S.categories = categories; S.products = products; S.rooms = rooms; S.bookings = bookings;
    await keep('catalog', { business, categories, products, rooms, bookings, at: Date.now() });
    S.online = true;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const c = await cached('catalog');
    if (c) { applyBusiness(c.business); S.categories = c.categories; S.products = c.products; S.rooms = c.rooms; S.bookings = c.bookings; }
    S.online = false;
  }
  await loadShift().catch(() => {});
  emit('catalog');
}

export async function loadShift() {
  const uid = S.session?.user?.id; if (!uid) return;
  const { data, error } = await S.sb.from('shifts').select('*').eq('user_id', uid).is('closed_at', null).maybeSingle();
  if (error) { if (isNetworkError(error)) { S.shift = (await cached('shift')) || null; return; } throw error; }
  S.shift = data; await keep('shift', data);
}

export async function loadIngredients() {
  const { data, error } = await S.sb.from('ingredients').select('*').order('name');
  if (error) throw error; S.ingredients = data; return data;
}

// ---- RPC ------------------------------------------------------------------
export async function rpc(fn, args) {
  const { data, error } = await S.sb.rpc(fn, args);
  if (error) { const e = new Error(errText(error)); e.code = error.code; e.status = error.status; e.cause = error; throw e; }
  return data;
}
export async function run(promise) {            // for plain table calls
  const { data, error } = await promise;
  if (error) { const e = new Error(errText(error)); e.code = error.code; throw e; }
  return data;
}
export async function reloadBookings() {
  const { data, error } = await S.sb.from('bookings').select('*, rooms(number)').in('status', ['reserved', 'checked_in']).order('check_in');
  if (error) throw error; S.bookings = data; emit('bookings'); return data;
}
export async function reloadRooms() {
  const { data, error } = await S.sb.from('rooms').select('*').order('number');
  if (error) throw error; S.rooms = data; emit('bookings'); return data;
}
