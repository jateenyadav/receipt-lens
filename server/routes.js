// ReceiptLens API: read a bill with AI, then save / edit / list / export receipts and monthly stats.

import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { route, parse, ApiError } from './lib/http.js';
import { CATEGORIES, checkMath, fingerprint, toCsv } from '../shared/receipt.js';
import { aiReceiptSchema, SYSTEM, imagePrompt, ocrPrompt, normaliseReceipt } from './extract.js';

const MAX_RECEIPTS = 2000;
const MAX_DEMO_RECEIPTS = 100;
const EXTRACT_CACHE_MS = 7 * 86400000;

/* ---------- model ---------- */

function receiptModel() {
  if (mongoose.models.Receipt) return mongoose.models.Receipt;
  const schema = new mongoose.Schema({
    userId: { type: String, required: true },
    merchant: { type: String, default: '' },
    date: { type: String, required: true }, // YYYY-MM-DD
    currency: { type: String, default: 'INR' },
    category: { type: String, default: 'Other' },
    items: [{ _id: false, name: String, quantity: Number, amount: Number }],
    subtotal: { type: Number, default: null },
    tax: { type: Number, default: null },
    extra: { type: Number, default: null },
    discount: { type: Number, default: null },
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: null },
    notes: { type: String, default: '' },
    source: { type: String, default: 'manual' },
    fingerprint: { type: String, index: true },
    mathOk: Boolean,
  }, { timestamps: true });
  schema.index({ userId: 1, date: -1 });
  return mongoose.model('Receipt', schema);
}

const view = (d) => ({
  id: String(d._id),
  merchant: d.merchant,
  date: d.date,
  currency: d.currency,
  category: d.category,
  items: d.items.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.amount })),
  subtotal: d.subtotal,
  tax: d.tax,
  extra: d.extra,
  discount: d.discount,
  total: d.total,
  paymentMethod: d.paymentMethod,
  notes: d.notes,
  source: d.source,
  mathOk: d.mathOk,
});

/* ---------- validation ---------- */

const money = z.number().finite().min(-1e9).max(1e9);
const optMoney = money.nullable().default(null);
export const receiptInput = z.object({
  merchant: z.string().trim().max(120).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-13'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code like INR').default('INR'),
  category: z.enum(CATEGORIES).default('Other'),
  items: z.array(z.object({
    name: z.string().trim().min(1, 'Every item needs a name').max(120),
    quantity: z.number().positive().max(100000).default(1),
    amount: money,
  })).max(200).default([]),
  subtotal: optMoney,
  tax: optMoney,
  extra: optMoney,
  discount: optMoney,
  total: money.min(0, 'Total cannot be negative'),
  paymentMethod: z.string().trim().max(40).nullable().default(null),
  notes: z.string().trim().max(500).default(''),
  source: z.enum(['ai', 'ocr', 'manual']).default('manual'),
});

const extractInput = z.object({
  image: z.object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    base64: z.string().min(100).max(4_000_000).regex(/^[A-Za-z0-9+/=]+$/, 'Image data is not valid'),
  }).optional(),
  ocrText: z.string().trim().min(10, 'Not enough text was found on the photo').max(20000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).refine((b) => Boolean(b.image) !== Boolean(b.ocrText), 'Send either a photo or OCR text');

const month = z.string().regex(/^\d{4}-\d{2}$/);

/* ---------- demo data ---------- */

function demoReceipts(today = new Date()) {
  const day = (monthsAgo, d) => {
    const x = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, d));
    return x.toISOString().slice(0, 10);
  };
  const r = (date, merchant, category, items, tax, extra, discount, paymentMethod) => {
    const sub = Math.round(items.reduce((s, [, , a]) => s + a, 0) * 100) / 100;
    return {
      date, merchant, category, currency: 'INR', paymentMethod, source: 'manual', notes: '',
      items: items.map(([name, quantity, amount]) => ({ name, quantity, amount })),
      subtotal: sub, tax, extra, discount, total: Math.round((sub + (tax || 0) + (extra || 0) - (discount || 0)) * 100) / 100,
    };
  };
  const thisDay = Math.max(1, Math.min(today.getUTCDate(), 28));
  return [
    r(day(0, thisDay), 'Chai Point', 'Food & Dining', [['Masala chai', 2, 120], ['Bun maska', 2, 110]], 11.5, null, null, 'UPI'),
    r(day(0, Math.max(1, thisDay - 2)), 'FreshMart Supermarket', 'Groceries', [['Toned milk 1L', 4, 272], ['Atta 5kg', 1, 289], ['Bananas', 1, 60], ['Paneer 200g', 2, 190]], null, null, 40, 'Card'),
    r(day(0, Math.max(1, thisDay - 4)), 'Indian Oil', 'Fuel', [['Petrol', 1, 1500]], null, null, null, 'UPI'),
    r(day(1, 9), 'Spice Route Restaurant', 'Food & Dining', [['Paneer tikka', 1, 340], ['Dal makhani', 1, 290], ['Butter naan', 4, 240], ['Sweet lassi', 3, 270]], 57, 114, null, 'Card'),
    r(day(1, 15), 'Apollo Pharmacy', 'Health', [['Paracetamol 650', 2, 64], ['Vitamin D3', 1, 245]], null, null, 15, 'Cash'),
    r(day(1, 22), 'Metro Card Recharge', 'Transport', [['Recharge', 1, 500]], null, null, null, 'UPI'),
    r(day(2, 5), 'BESCOM', 'Bills & Utilities', [['Electricity bill', 1, 1840]], null, null, null, 'UPI'),
    r(day(2, 18), 'PVR Cinemas', 'Entertainment', [['Movie tickets', 2, 560], ['Popcorn combo', 1, 420]], 176.4, 60, null, 'Card'),
  ];
}

/* ---------- exports used by app.js ---------- */

export const BIG_BODY = ['/extract'];

export async function seedDemo(user) {
  const Receipt = receiptModel();
  await Receipt.insertMany(demoReceipts().map((r) => ({ ...r, userId: String(user._id), fingerprint: fingerprint(r), mathOk: checkMath(r).ok })));
}

export async function deleteUserData(userId) {
  await receiptModel().deleteMany({ userId: String(userId) });
}

export function appRoutes({ ai, aiQuota, requireUser }) {
  const r = express.Router();
  const Receipt = receiptModel();
  const big = express.json({ limit: '5mb' }); // photo uploads only

  const findDuplicate = async (userId, data, exceptId) => {
    if (!data.date || data.total == null) return null;
    const dup = await Receipt.findOne({ userId, fingerprint: fingerprint(data), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
    return dup ? { id: String(dup._id), merchant: dup.merchant, date: dup.date, total: dup.total } : null;
  };

  // Read a bill. Nothing is saved: the user checks and edits the draft first.
  r.post('/extract', requireUser, big, route(async (req, res) => {
    const body = parse(extractInput, req.body);
    const quota = await aiQuota(req.user);
    const hint = body.currency || 'INR';
    const raw = body.image
      ? await ai.json(aiReceiptSchema, { label: 'receipt-image', system: SYSTEM, prompt: imagePrompt(hint), image: body.image, maxTokens: 2500, cacheTtlMs: EXTRACT_CACHE_MS })
      : await ai.json(aiReceiptSchema, { label: 'receipt-ocr', system: SYSTEM, prompt: ocrPrompt(body.ocrText, hint), maxTokens: 2500, cacheTtlMs: EXTRACT_CACHE_MS });
    if (!raw.isReceipt) throw new ApiError(422, "This doesn't look like a bill or receipt. Try a clearer photo of the whole bill.");
    const draft = normaliseReceipt(raw, { currencyHint: hint, source: body.image ? 'ai' : 'ocr' });
    res.json({ draft, math: checkMath(draft), duplicate: await findDuplicate(String(req.user._id), draft), remaining: quota.remaining });
  }));

  r.get('/receipts', requireUser, route(async (req, res) => {
    const m = req.query.month ? parse(month, req.query.month) : null;
    const filter = { userId: String(req.user._id), ...(m ? { date: { $gte: `${m}-01`, $lte: `${m}-31` } } : {}) };
    const docs = await Receipt.find(filter).sort({ date: -1, createdAt: -1 }).limit(500);
    res.json({ receipts: docs.map(view) });
  }));

  r.post('/receipts', requireUser, route(async (req, res) => {
    const data = parse(receiptInput, req.body);
    const userId = String(req.user._id);
    const limit = req.user.demo ? MAX_DEMO_RECEIPTS : MAX_RECEIPTS;
    if (await Receipt.countDocuments({ userId }) >= limit) throw new ApiError(403, `You can keep up to ${limit} receipts. Delete some old ones first.`);
    const duplicate = await findDuplicate(userId, data);
    const doc = await Receipt.create({ ...data, userId, fingerprint: fingerprint(data), mathOk: checkMath(data).ok });
    res.status(201).json({ receipt: view(doc), duplicate });
  }));

  const ownId = (req) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Receipt not found.');
    return { _id: req.params.id, userId: String(req.user._id) };
  };

  r.put('/receipts/:id', requireUser, route(async (req, res) => {
    const data = parse(receiptInput, req.body);
    const doc = await Receipt.findOneAndUpdate(ownId(req), { ...data, fingerprint: fingerprint(data), mathOk: checkMath(data).ok }, { returnDocument: 'after' });
    if (!doc) throw new ApiError(404, 'Receipt not found.');
    res.json({ receipt: view(doc) });
  }));

  r.delete('/receipts/:id', requireUser, route(async (req, res) => {
    const out = await Receipt.deleteOne(ownId(req));
    if (!out.deletedCount) throw new ApiError(404, 'Receipt not found.');
    res.json({ ok: true });
  }));

  r.get('/export.csv', requireUser, route(async (req, res) => {
    const m = req.query.month ? parse(month, req.query.month) : null;
    const filter = { userId: String(req.user._id), ...(m ? { date: { $gte: `${m}-01`, $lte: `${m}-31` } } : {}) };
    const docs = await Receipt.find(filter).sort({ date: 1 }).lean();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="receipts${m ? `-${m}` : ''}.csv"`);
    res.send(`﻿${toCsv(docs)}`); // BOM so Excel reads ₹ and other symbols correctly
  }));

  // Spend per month and category for the last N months.
  r.get('/stats', requireUser, route(async (req, res) => {
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString().slice(0, 10);
    const rows = await Receipt.aggregate([
      { $match: { userId: String(req.user._id), date: { $gte: from } } },
      { $group: { _id: { month: { $substrCP: ['$date', 0, 7] }, category: '$category', currency: '$currency' }, total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { '_id.month': 1 } },
    ]);
    res.json({
      from,
      months,
      rows: rows.map((x) => ({ month: x._id.month, category: x._id.category, currency: x._id.currency, total: Math.round(x.total * 100) / 100, count: x.count })),
    });
  }));

  return r;
}
