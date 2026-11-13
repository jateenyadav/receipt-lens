// Accuracy check: run the real extractor on public CORD v2 receipts (CC BY 4.0, naver-clova-ix/cord-v2)
// and compare with the hand-labelled answers. Writes docs/eval-results.md + docs/eval-results.json.
//
//   node scripts/eval.mjs            # needs GEMINI_API_KEY (+ optional GROQ/OPENROUTER) in env or shared.env
//   node scripts/eval.mjs --n 10     # fewer receipts
//   node scripts/eval.mjs --fake     # dry run against the local fake AI (checks the script, not the AI)
//
// CORD receipts are Indonesian (IDR, no decimals; "60.000" means 60,000), which makes number reading harder
// than typical Indian bills: a fair stress test.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAi, providersFromEnv } from '../server/lib/ai.js';
import { aiReceiptSchema, SYSTEM, imagePrompt, normaliseReceipt } from '../server/extract.js';
import { checkMath } from '../shared/receipt.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const N = Number(arg('--n', 30));
const FAKE = process.argv.includes('--fake');
const CACHE = resolve('eval/.cache');

for (const file of [resolve('.env'), resolve(process.env.HOME || '', 'Desktop/RND/.secrets/shared.env')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.GEMINI_REASONING_EFFORT ||= 'none';

let fake;
if (FAKE) {
  const { startFakeAi } = await import('../server/dev/fake-ai.mjs');
  const fixtures = (await import('../server/dev/fixtures.mjs')).default;
  fake = await startFakeAi({ fixtures });
  Object.assign(process.env, { GEMINI_API_KEY: 'fake', GEMINI_BASE_URL: fake.url });
}
const ai = createAi({ providers: providersFromEnv(), timeoutMs: 30000 });
if (!ai.status().providers.some((p) => p.vision)) {
  console.error('No AI that can read images is configured. Add GEMINI_API_KEY to ~/Desktop/RND/.secrets/shared.env (or run with --fake).');
  process.exit(1);
}

/** CORD numbers: digits only (thousand separators are "." or ","), sign kept. */
const gtNum = (v) => {
  if (v == null) return null;
  const s = String(Array.isArray(v) ? v[0] : v);
  const digits = s.replace(/[^\d]/g, '');
  return digits ? (s.trim().startsWith('-') ? -1 : 1) * Number(digits) : null;
};
const close = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

async function fetchRows(offset, length) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=naver-clova-ix/cord-v2&config=default&split=test&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset ${res.status}`);
  return (await res.json()).rows.map((r) => r.row);
}

async function loadSample(i, row) {
  mkdirSync(CACHE, { recursive: true });
  const file = resolve(CACHE, `${i}.jpg`);
  if (!existsSync(file)) {
    const res = await fetch(row.image.src);
    if (!res.ok) throw new Error(`image ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const gt = JSON.parse(row.ground_truth).gt_parse;
  const menu = gt.menu == null ? [] : Array.isArray(gt.menu) ? gt.menu : [gt.menu];
  return {
    i,
    base64: readFileSync(file).toString('base64'),
    truth: {
      total: gtNum(gt.total?.total_price),
      subtotal: gtNum(gt.sub_total?.subtotal_price),
      tax: gtNum(gt.sub_total?.tax_price),
      items: menu.length,
    },
  };
}

const rows = [];
for (let off = 0; rows.length < N; off += 20) rows.push(...await fetchRows(off, Math.min(20, N - rows.length)));
const results = [];
for (const [i, row] of rows.entries()) {
  const s = await loadSample(i, row);
  const t0 = Date.now();
  try {
    const raw = await ai.json(aiReceiptSchema, { label: 'eval', system: SYSTEM, prompt: imagePrompt('IDR'), image: { mimeType: 'image/jpeg', base64: s.base64 }, maxTokens: 2500 });
    const r = normaliseReceipt(raw, { currencyHint: 'IDR' });
    results.push({
      i, ms: Date.now() - t0, ok: true, truth: s.truth,
      got: { total: r.total, subtotal: r.subtotal, tax: r.tax, items: r.items.length, merchant: r.merchant, currency: r.currency },
      total: close(r.total, s.truth.total),
      subtotal: s.truth.subtotal == null ? null : close(r.subtotal, s.truth.subtotal),
      tax: s.truth.tax == null ? null : close(r.tax, s.truth.tax),
      items: r.items.length === s.truth.items,
      mathOk: checkMath(r).ok,
    });
  } catch (err) {
    results.push({ i, ms: Date.now() - t0, ok: false, error: String(err?.message || err).slice(0, 200), truth: s.truth });
  }
  const last = results.at(-1);
  console.log(`#${i} ${last.ok ? `total ${last.total ? '✓' : '✗'} (${last.got.total} vs ${s.truth.total}) items ${last.got.items}/${s.truth.items}` : `ERROR ${last.error}`} ${last.ms} ms`);
  if (!FAKE) await new Promise((r) => setTimeout(r, 6500)); // stay under free-tier requests per minute
}
await fake?.close();

const pct = (xs) => (xs.length ? `${Math.round((xs.filter(Boolean).length / xs.length) * 100)}% (${xs.filter(Boolean).length}/${xs.length})` : 'n/a');
const done = results.filter((r) => r.ok);
const ms = done.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  date: new Date().toISOString().slice(0, 10),
  receipts: results.length,
  fake: FAKE,
  providers: ai.status().providers.filter((p) => p.vision).map((p) => `${p.name}:${p.model}`),
  answered: pct(results.map((r) => r.ok)),
  total: pct(done.map((r) => r.total)),
  subtotal: pct(done.filter((r) => r.subtotal !== null).map((r) => r.subtotal)),
  tax: pct(done.filter((r) => r.tax !== null).map((r) => r.tax)),
  itemCount: pct(done.map((r) => r.items)),
  mathCheckPassed: pct(done.map((r) => r.mathOk)),
  medianMs: ms[Math.floor(ms.length / 2)] ?? null,
  p90Ms: ms[Math.floor(ms.length * 0.9)] ?? null,
};

mkdirSync('docs', { recursive: true });
const name = FAKE ? 'eval-results.fake' : 'eval-results';
writeFileSync(`docs/${name}.json`, JSON.stringify({ summary, results }, null, 2));
writeFileSync(`docs/${name}.md`, `# ReceiptLens accuracy (${summary.date})

${FAKE ? '> DRY RUN against the fake AI: these numbers say nothing about real accuracy.\n\n' : ''}Dataset: first ${summary.receipts} receipts of the CORD v2 test split (Indonesian receipts, CC BY 4.0).
Model: ${summary.providers.join(', ')}. A value counts as correct within 0.5%.

| Field | Correct |
|---|---|
| Got an answer | ${summary.answered} |
| Total | ${summary.total} |
| Subtotal (where printed) | ${summary.subtotal} |
| Tax (where printed) | ${summary.tax} |
| Number of items | ${summary.itemCount} |
| Our maths check passed | ${summary.mathCheckPassed} |

Time per receipt: median ${summary.medianMs} ms, 90th percentile ${summary.p90Ms} ms.

Re-run: \`node scripts/eval.mjs\`.
`);
console.log('\n', summary);
