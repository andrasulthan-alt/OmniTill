// Shared app state with a minimal event bus.
export const S = {
  cfg: null, sb: null, session: null, profile: null,
  business: { name: 'OmniTill', currency: 'IDR', locale: 'id-ID', timezone: 'Asia/Jakarta', tax_rate: 0, service_rate: 0, receipt_footer: '', hotel_enabled: true, updated_at: null },
  categories: [], products: [], rooms: [], bookings: [], ingredients: [], shift: null,
  online: navigator.onLine, outbox: 0, rejected: 0, lastSync: null,
};
const subs = {};
export const on = (ev, fn) => { (subs[ev] ||= new Set()).add(fn); return () => subs[ev].delete(fn); };
export const emit = (ev, d) => { (subs[ev] || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); };
export const role = () => (S.profile && S.profile.active ? S.profile.role : null);
export const can = (...r) => r.includes(role());
export const isManager = () => can('manager', 'admin');
