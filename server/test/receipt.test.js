import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMath, splitBill, splitMessage, parseAmount, fingerprint, toCsv } from '../../shared/receipt.js';
import { normaliseDate, normaliseReceipt } from '../extract.js';

const bill = { merchant: 'Cafe', date: '2026-11-12', currency: 'INR', items: [{ name: 'Tea', amount: 100 }, { name: 'Cake', amount: 200 }], subtotal: 300, tax: 15, extra: null, discount: 10, total: 305 };

test('maths check passes a correct bill and explains a wrong one', () => {
  assert.equal(checkMath(bill).ok, true);
  const wrong = checkMath({ ...bill, total: 400 });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.diff, 95);
  const items = checkMath({ ...bill, subtotal: 350, total: 355 });
  assert.match(items.problems[0], /Items add up to 300.00/);
  assert.match(checkMath({ ...bill, total: null }).problems[0], /no total/);
  assert.equal(checkMath({ ...bill, total: 305.4 }).ok, true, 'tiny rounding is fine');
});

test('equal split always adds up to the total', () => {
  const s = splitBill({ total: 100 }, { people: ['A', 'B', 'C'] });
  assert.deepEqual(s.shares.map((x) => x.amount), [33.34, 33.33, 33.33]);
  assert.equal(s.shares.reduce((a, b) => a + b.amount, 0).toFixed(2), '100.00');
});

test('item split shares tax/discount in proportion and shared items equally', () => {
  // A had tea (100), B had cake (200) → 1/3 and 2/3 of 305
  const s = splitBill(bill, { people: ['A', 'B'], mode: 'items', assign: [[0], [1]] });
  assert.deepEqual(s.shares.map((x) => x.amount), [101.67, 203.33]);
  const shared = splitBill(bill, { people: ['A', 'B'], mode: 'items', assign: [[0], []] });
  assert.deepEqual(shared.shares.map((x) => x.amount), [203.33, 101.67]);
  assert.deepEqual(shared.shares[1].items, ['Cake (shared)']);
  assert.equal(splitBill(bill, { people: [' ', ''] }).shares.length, 0);
});

test('item split where everyone shares everything matches an equal split', () => {
  const r = { total: 914, items: [{ name: 'a', amount: 340 }, { name: 'b', amount: 290 }, { name: 'c', amount: 240 }] };
  const s = splitBill(r, { people: ['A', 'B', 'C'], mode: 'items', assign: [[], [], []] });
  assert.deepEqual(s.shares.map((x) => x.amount), [304.67, 304.67, 304.66]);
});

test('WhatsApp message lists everyone', () => {
  const msg = splitMessage(bill, splitBill(bill, { people: ['Asha', 'Ravi'] }));
  assert.match(msg, /\*Cafe\*/);
  assert.match(msg, /Asha: \*₹152.50\*/);
});

test('amount parsing handles symbols and separators', () => {
  assert.equal(parseAmount('₹1,234.50'), 1234.5);
  assert.equal(parseAmount('1.234,50'), 1234.5);
  assert.equal(parseAmount('Rp 12.000.000'), 12000000);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('-20'), -20);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('fingerprint ignores case and punctuation of the shop name', () => {
  assert.equal(fingerprint({ merchant: 'Café Coffee Day!', date: '2026-11-01', total: 99.9 }), fingerprint({ merchant: 'caf coffee day', date: '2026-11-01', total: 99.9 }));
});

test('CSV quotes commas and neutralises formulas', () => {
  const csv = toCsv([{ ...bill, merchant: 'Tea, Cakes & Co', notes: '+cmd' }]);
  assert.match(csv, /"Tea, Cakes & Co"/);
  assert.match(csv, /'\+cmd/);
  assert.match(csv, /,-?\d/);
});

test('dates: DD/MM/YYYY, ISO, nonsense and the future', () => {
  const today = new Date('2026-11-13T00:00:00Z');
  assert.equal(normaliseDate('12/11/2026', today), '2026-11-12');
  assert.equal(normaliseDate('2026-11-01', today), '2026-11-01');
  assert.equal(normaliseDate('05-01-26', today), '2026-01-05');
  assert.equal(normaliseDate('31/02/2026', today), null);
  assert.equal(normaliseDate('2030-01-01', today), null);
  assert.equal(normaliseDate('yesterday', today), null);
});

test('normalise maps categories, currency and signs', () => {
  const r = normaliseReceipt({ merchant: 'X', category: 'GROCERIES', currency: 'usd', discount: -5, total: 10, items: [{ name: 'a', amount: 10, quantity: null }, { name: null, amount: 1 }] });
  assert.equal(r.category, 'Groceries');
  assert.equal(r.currency, 'USD');
  assert.equal(r.discount, 5);
  assert.deepEqual(r.items, [{ name: 'a', quantity: 1, amount: 10 }]);
  assert.equal(normaliseReceipt({ category: 'Spaceships', currency: '₹' }).category, 'Other');
  assert.equal(normaliseReceipt({ currency: '₹' }, { currencyHint: 'INR' }).currency, 'INR');
});
