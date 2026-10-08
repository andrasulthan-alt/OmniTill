// Offline-first sale queue + live refresh.
// A sale is saved on the device first, then sent. The sale id is made on the device, so sending
// it twice (bad signal, double tap, two tabs) can never create two sales.
import { S, emit } from './state.js';
import { outboxAll, outboxPut, outboxDel } from './store.js';
import { rpc, isNetworkError, loadCatalog, reloadBookings } from './api.js';
import { receiptNo, uuid } from './util.js';

let flushing = null;
export const results = new Map();     // sale id -> server answer (receipt number, total)

export async function refreshCounts() {
  const all = await outboxAll();
  S.outbox = all.filter((r) => !r.rejected).length;
  S.rejected = all.filter((r) => r.rejected).length;
  emit('sync');
}

// Save a sale locally, then try to send it right away.
export async function queueSale(sale) {
  const row = { id: sale.id || uuid(), no: sale.no || receiptNo(), created: Date.now(), payload: null, userId: S.session?.user?.id || null, rejected: null, tries: 0 };
  row.payload = { ...sale, id: row.id, no: row.no, sold_at: new Date(row.created).toISOString(), shift_id: S.shift?.id || null, tax_rate: S.business.tax_rate, service_rate: S.business.service_rate };
  await outboxPut(row);
  await refreshCounts();
  const result = await flush().then(() => outboxAll()).then((all) => all.find((r) => r.id === row.id));
  return { row, synced: !result, rejected: result?.rejected || null };
}

export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const all = (await outboxAll()).filter((r) => !r.rejected && (!r.userId || r.userId === S.session?.user?.id));
      for (const r of all) {
        try {
          const res = await rpc('checkout', { p: r.payload });
          await outboxDel(r.id);
          results.set(r.id, res);
          emit('sale-synced', { id: r.id, result: res });
          S.online = true; S.lastSync = Date.now();
        } catch (e) {
          if (isNetworkError(e)) { S.online = false; break; }          // keep it, try again later
          r.rejected = e.message; r.tries++; await outboxPut(r);       // the server said no: keep it visible, never lose a paid sale
          emit('sale-rejected', { id: r.id, message: e.message });
        }
      }
    } finally { flushing = null; await refreshCounts(); }
  })();
  return flushing;
}

export const rejectedSales = async () => (await outboxAll()).filter((r) => r.rejected);
export async function retryRejected(id) {
  const r = (await outboxAll()).find((x) => x.id === id); if (!r) return;
  r.rejected = null; await outboxPut(r); await refreshCounts(); return flush();
}
export async function discardSale(id) { await outboxDel(id); await refreshCounts(); }

// ---- live updates ---------------------------------------------------------
let chan, poll, reloadT;
const soon = (fn) => { clearTimeout(reloadT); reloadT = setTimeout(fn, 400); };

export function startLive() {
  stopLive();
  const refresh = async () => { try { await loadCatalog(); await flush(); } catch { /* offline */ } };
  try {
    chan = S.sb.channel('ot-live');
    for (const t of ['products', 'categories', 'rooms', 'bookings', 'ingredients', 'business', 'sales']) {
      chan.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => {
        if (t === 'bookings') soon(() => reloadBookings().catch(() => {}));
        else if (t === 'sales') emit('remote-sale', p);
        else if (t === 'ingredients') emit('remote-stock', p);
        else soon(refresh);
      });
    }
    chan.subscribe();
  } catch { /* realtime unavailable: polling below still keeps devices in step */ }
  poll = setInterval(() => { if (document.visibilityState === 'visible') { flush(); if (!S.outbox) refresh(); } }, 30000);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
}
export function stopLive() {
  try { chan && S.sb.removeChannel(chan); } catch { /* ignore */ }
  chan = null; clearInterval(poll);
  window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onVisible);
}
const onOnline = async () => { S.online = true; emit('sync'); await flush(); try { await loadCatalog(); } catch { /* ignore */ } };
const onOffline = () => { S.online = false; emit('sync'); };
const onVisible = () => { if (document.visibilityState === 'visible') { flush(); } };
