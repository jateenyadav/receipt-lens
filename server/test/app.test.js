import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startFakeAi } from '../dev/fake-ai.mjs';
import fixtures from '../dev/fixtures.mjs';
import { createAi, providersFromEnv } from '../lib/ai.js';
import { memoryCounterStore } from '../lib/limits.js';
import { connectDb } from '../lib/db.js';
import { createApp } from '../app.js';

let mem, fake, app;
const photo = { mimeType: 'image/jpeg', base64: 'A'.repeat(400) };

before(async () => {
  mem = await MongoMemoryServer.create();
  fake = await startFakeAi({ fixtures });
  const ai = createAi({ providers: providersFromEnv({ GROQ_API_KEY: 'x', GROQ_BASE_URL: fake.url, GEMINI_API_KEY: 'x', GEMINI_BASE_URL: fake.url }) });
  app = createApp({ ai, counters: memoryCounterStore(), db: () => connectDb(mem.getUri(), 'receipt-lens-test'), limits: { aiPerDay: 4 } });
});
after(async () => { await mongoose.disconnect(); await mem.stop(); await fake.close(); });

const demo = async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/demo').send({}).expect(201);
  return agent;
};

test('health is public', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
});

test('the Netlify function path works too', async () => {
  await request(app).get('/.netlify/functions/api/health').expect(200);
});

test('reading a bill needs a login, and big bodies are not parsed before login', async () => {
  await request(app).post('/api/extract').send({ image: photo }).expect(401);
  await request(app).post('/api/receipts').send({}).expect(401);
});

test('demo account starts with sample receipts and stats', async () => {
  const agent = await demo();
  const list = await agent.get('/api/receipts').expect(200);
  assert.ok(list.body.receipts.length >= 6);
  assert.ok(list.body.receipts.every((r) => r.mathOk));
  const stats = await agent.get('/api/stats?months=3').expect(200);
  assert.ok(stats.body.rows.some((r) => r.category === 'Food & Dining'));
});

test('photo → clean draft with a passing maths check, sent to the vision model', async () => {
  const agent = await demo();
  const before = fake.calls.length;
  const res = await agent.post('/api/extract').send({ image: photo }).expect(200);
  const { draft, math } = res.body;
  assert.equal(draft.merchant, 'Spice Route Restaurant');
  assert.equal(draft.date, '2026-11-12');
  assert.equal(draft.category, 'Food & Dining');
  assert.equal(draft.items[2].amount, 240);
  assert.equal(draft.total, 914);
  assert.equal(draft.source, 'ai');
  assert.equal(math.ok, true);
  const sent = fake.calls.slice(before).find((c) => c.path === '/chat/completions');
  assert.equal(sent.body.messages.at(-1).content[1].type, 'image_url');
});

test('OCR text path flags a bill whose maths is off', async () => {
  const agent = await demo();
  const res = await agent.post('/api/extract').send({ ocrText: 'SPICE ROUTE\nPaneer tikka 340\nTOTAL 999' }).expect(200);
  assert.equal(res.body.draft.source, 'ocr');
  assert.equal(res.body.math.ok, false);
  assert.match(res.body.math.problems[0], /total says/);
});

test('extract validates input', async () => {
  const agent = await demo();
  await agent.post('/api/extract').send({}).expect(400);
  await agent.post('/api/extract').send({ image: { mimeType: 'image/gif', base64: 'A'.repeat(400) } }).expect(400);
  const res = await agent.post('/api/extract').send({ image: photo, ocrText: 'both is not allowed here' }).expect(400);
  assert.match(res.body.error, /either/);
});

test('a photo that is not a bill gets a friendly 422', async () => {
  const agent = await demo();
  const res = await agent.post('/api/extract').send({ ocrText: 'NOT_A_RECEIPT this is a cat photo' }).expect(422);
  assert.match(res.body.error, /doesn't look like a bill/);
});

test('daily AI cap returns 429', async () => {
  const agent = await demo();
  for (let i = 0; i < 4; i++) await agent.post('/api/extract').send({ image: { ...photo, base64: `B${i}`.padEnd(400, 'A') } }).expect(200);
  const res = await agent.post('/api/extract').send({ image: photo }).expect(429);
  assert.match(res.body.error, /today/);
});

test('save → duplicate warning → edit → CSV → delete; other users cannot touch it', async () => {
  const agent = await demo();
  const { body: { draft } } = await agent.post('/api/extract').send({ image: photo }).expect(200);
  const first = await agent.post('/api/receipts').send(draft).expect(201);
  assert.equal(first.body.duplicate, null);
  const again = await agent.post('/api/extract').send({ image: photo }).expect(200);
  assert.equal(again.body.duplicate.id, first.body.receipt.id);
  const second = await agent.post('/api/receipts').send(draft).expect(201);
  assert.equal(second.body.duplicate.id, first.body.receipt.id);

  const id = first.body.receipt.id;
  const edited = await agent.put(`/api/receipts/${id}`).send({ ...draft, notes: '=HYPERLINK("x")', total: 1000 }).expect(200);
  assert.equal(edited.body.receipt.mathOk, false);

  const csv = await agent.get('/api/export.csv?month=2026-11').expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Spice Route Restaurant/);
  assert.match(csv.text, /"'=HYPERLINK/); // formula injection neutralised

  const stranger = await demo();
  await stranger.delete(`/api/receipts/${id}`).expect(404);
  await stranger.put(`/api/receipts/${id}`).send(draft).expect(404);
  await agent.delete(`/api/receipts/${id}`).expect(200);
  await agent.delete(`/api/receipts/${id}`).expect(404);
  await agent.delete('/api/receipts/not-an-id').expect(404);
});

test('save validates the receipt', async () => {
  const agent = await demo();
  const res = await agent.post('/api/receipts').send({ date: '13-11-2026', total: 10 }).expect(400);
  assert.match(res.body.error, /date/);
  await agent.post('/api/receipts').send({ date: '2026-11-13', total: -5 }).expect(400);
  await agent.post('/api/receipts').send({ date: '2026-11-13', total: 5, category: 'Bribes' }).expect(400);
});

test('deleting the account removes its receipts', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'Asha', email: 'asha@example.com', password: 'longpassword' }).expect(201);
  await agent.post('/api/receipts').send({ date: '2026-11-13', total: 50, merchant: 'Kirana' }).expect(201);
  const me = await agent.get('/api/auth/me').expect(200);
  await agent.delete('/api/auth/account').send({ password: 'longpassword' }).expect(200);
  assert.equal(await mongoose.connection.collection('receipts').countDocuments({ userId: me.body.user.id }), 0);
});

test('register, login, delete account', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'Ravi', email: 'ravi@example.com', password: 'longpassword' }).expect(201);
  await request(app).post('/api/auth/login').send({ email: 'ravi@example.com', password: 'wrongpassword' }).expect(401);
  await agent.delete('/api/auth/account').send({ password: 'wrongpassword' }).expect(403);
  await agent.delete('/api/auth/account').send({ password: 'longpassword' }).expect(200);
});

test('cross-site writes are blocked', async () => {
  await request(app).post('/api/auth/demo').set('Origin', 'https://evil.example').send({}).expect(403);
});
