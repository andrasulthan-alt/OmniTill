// Order maths. The server repeats this and its answer wins; this only previews it.
const ZERO_DEC = new Set(['IDR', 'JPY', 'KRW', 'VND', 'CLP']);
export const scaleFor = (currency) => (ZERO_DEC.has(currency) ? 0 : 2);
const rnd = (n, d) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
export function totals(lines, { discount = 0, discountType = 'amount', tax_rate = 0, service_rate = 0, currency = 'IDR' } = {}) {
  const d = scaleFor(currency);
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  let disc = discountType === 'percent' ? rnd(subtotal * Math.min(Math.max(discount, 0), 100) / 100, d) : Math.max(discount, 0);
  disc = Math.min(disc, subtotal);
  const base = subtotal - disc;
  const service = rnd(base * service_rate / 100, d);
  const tax = rnd((base + service) * tax_rate / 100, d);
  const total = rnd(base + service + tax, d);
  return { subtotal, discount: disc, service, tax, total };
}
export function quickCash(total, currency) {
  const steps = scaleFor(currency) === 0 ? [10000, 50000, 100000] : [5, 10, 20, 50, 100];
  const out = [total];
  for (const s of steps) { const v = Math.ceil(total / s) * s; if (!out.includes(v)) out.push(v); }
  return out.slice(0, 4);
}
