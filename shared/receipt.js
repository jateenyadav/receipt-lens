// Receipt logic shared by the server and the browser (no dependencies).
// Money is handled in integer cents internally so splits always add up exactly.

export const CATEGORIES = [
  'Groceries',
  'Food & Dining',
  'Shopping',
  'Transport',
  'Fuel',
  'Health',
  'Bills & Utilities',
  'Entertainment',
  'Travel',
  'Other',
];

const cents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;
export const round2 = (n) => fromCents(cents(n));

/** Sum of item line amounts. */
export function itemsTotal(items = []) {
  return fromCents(items.reduce((s, it) => s + cents(it.amount), 0));
}

/**
 * Check that the bill adds up.
 *  - items must add up to the subtotal (when the bill prints one)
 *  - subtotal (or items) + tax + extra − discount must equal the total
 * Returns { ok, itemsSum, expectedTotal, diff, problems: string[] }.
 */
export function checkMath(r, fmt = (n) => n.toFixed(2)) {
  const problems = [];
  const itemsSum = itemsTotal(r.items);
  const base = r.subtotal ?? (r.items?.length ? itemsSum : null);
  const total = r.total;
  const tol = (amount) => Math.max(0.05, Math.abs(amount) * 0.002);

  if (r.subtotal != null && r.items?.length && Math.abs(itemsSum - r.subtotal) > tol(r.subtotal)) {
    problems.push(`Items add up to ${fmt(itemsSum)}, but the bill's subtotal is ${fmt(r.subtotal)}.`);
  }
  let expectedTotal = null;
  let diff = 0;
  if (total == null) {
    problems.push('The bill has no total.');
  } else if (base != null) {
    expectedTotal = fromCents(cents(base) + cents(r.tax) + cents(r.extra) - cents(r.discount));
    diff = round2(total - expectedTotal);
    if (Math.abs(diff) > tol(total)) {
      problems.push(`Subtotal + tax + extras − discount = ${fmt(expectedTotal)}, but the total says ${fmt(total)} (${diff > 0 ? '+' : ''}${fmt(diff)}).`);
    }
  }
  return { ok: problems.length === 0, itemsSum, expectedTotal, diff, problems };
}

/** Format money in the receipt's currency; falls back to a plain number for unknown codes. */
export function money(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount ?? 0);
  } catch {
    return `${currency} ${(amount ?? 0).toFixed(2)}`;
  }
}

/** Split `total` cents into parts proportional to `weights`; the parts always add up to total. */
function proportional(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wSum = sum > 0 ? sum : w.length;
  const parts = w.map((x) => Math.floor((totalCents * x) / wSum));
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  // Hand leftover cents to the largest remainders first.
  const order = w.map((x, i) => [((totalCents * x) / wSum) - parts[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k][1]] += 1;
  return parts;
}

/**
 * Split a bill between people.
 * mode 'equal': everyone pays the same.
 * mode 'items': assign[i] = indexes of people who shared item i (empty = everyone).
 *   Tax, extras and discount are shared in proportion to what each person ordered.
 * Returns { total, shares: [{ name, amount, items: string[] }] } — amounts always add up to the total.
 */
export function splitBill(r, { people, mode = 'equal', assign = [] }) {
  const names = people.map((p) => String(p).trim()).filter(Boolean);
  if (!names.length) return { total: r.total ?? 0, shares: [] };
  const totalCents = cents(r.total ?? itemsTotal(r.items));
  const items = mode === 'items' ? r.items || [] : [];
  const base = names.map(() => 0);
  const lists = names.map(() => []);
  items.forEach((it, i) => {
    const who = (assign[i] || []).filter((p) => p >= 0 && p < names.length);
    const sharers = who.length ? who : names.map((_, p) => p);
    // Keep exact fractions here; rounding happens once at the end, so leftover paise are spread fairly.
    for (const p of sharers) {
      base[p] += cents(it.amount) / sharers.length;
      lists[p].push(sharers.length > 1 ? `${it.name} (shared)` : it.name);
    }
  });
  const parts = mode === 'items' && base.some((b) => b > 0) ? proportional(totalCents, base) : proportional(totalCents, names.map(() => 1));
  return { total: fromCents(totalCents), shares: names.map((name, i) => ({ name, amount: fromCents(parts[i]), items: lists[i] })) };
}

/** Ready-to-send WhatsApp text for a split. */
export function splitMessage(r, split) {
  const cur = r.currency || 'INR';
  const head = `🧾 *${r.merchant || 'Bill'}*${r.date ? ` · ${r.date}` : ''}\nTotal: ${money(split.total, cur)}\n`;
  const lines = split.shares.map((s) => `• ${s.name}: *${money(s.amount, cur)}*${s.items.length ? `\n   ${s.items.join(', ')}` : ''}`);
  return `${head}\n${lines.join('\n')}\n\nSplit with ReceiptLens`;
}

/** Same shop + same day + same total → probably the same bill saved twice. */
export function fingerprint(r) {
  const shop = String(r.merchant || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  return `${shop}|${r.date || ''}|${cents(r.total)}`;
}

/** Turn a number string like "₹1,234.50", "1.234,50" or "Rp 12.000" into a number (or null). */
export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const negative = /^-|^\(.*\)$|-$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(',', '.');
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet formula injection from text fields (numbers are written as-is).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with one row per receipt. */
export function toCsv(receipts) {
  const head = ['date', 'merchant', 'category', 'currency', 'subtotal', 'tax', 'extra', 'discount', 'total', 'payment', 'items', 'notes'];
  const rows = receipts.map((r) => [
    r.date, r.merchant, r.category, r.currency, r.subtotal, r.tax, r.extra, r.discount, r.total, r.paymentMethod,
    (r.items || []).map((it) => `${it.name}${it.quantity && it.quantity !== 1 ? ` x${it.quantity}` : ''} = ${it.amount}`).join('; '),
    r.notes,
  ].map(csvCell).join(','));
  return `${head.join(',')}\n${rows.join('\n')}\n`;
}
