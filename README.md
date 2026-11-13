# ReceiptLens

**Live website:** https://receipt-lens-jateen.netlify.app · [![CI](https://github.com/jateenyadav/receipt-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/jateenyadav/receipt-lens/actions/workflows/ci.yml)

Snap a bill. Get clean data, a maths check and a bill split.

Take a photo of any shop or restaurant bill. ReceiptLens reads the shop, date, items, tax and total. It
checks that the numbers add up, splits the bill with friends as a WhatsApp message, and charts your spending
by month. Click **Try the demo** on the live site; no sign-up needed.

<!-- demo video: docs/demo.mp4 -->

## Features
- **AI reads the bill.** A vision model returns structured data. The data is schema-checked and cleaned up
  before you see it: dates like `12/11/2026` become ISO dates, `₹1,234.50` becomes `1234.5`, and the
  category is picked from a fixed list.
- **Maths check.** It confirms items = subtotal, and subtotal + tax + extras − discount = total. If not, it
  explains the gap and offers the calculated total with one click. This catches both AI misreads and wrong
  bills.
- **Split the bill.** Split it equally, or by what each person had (shared items split evenly). Tax, service
  charge and discount are shared in proportion to what each person ordered. The shares always add up to the
  total exactly: money is handled in paise, and leftover paise go to the largest remainders.
- **Works when the AI is busy.** If the photo AI is down or rate-limited, the phone reads the text itself
  (tesseract.js) and only that text goes to a text model. If that fails too, you type the bill in, with the
  text found on the photo shown alongside.
- **Duplicate warning** when the same shop + day + total is already saved.
- **Monthly chart**, a category table and a **CSV export** that is safe to open in Excel (formula injection
  is neutralised).
- **Privacy.** Photos are shrunk in the browser and never stored; only the receipt text is saved. You can
  delete your account and all receipts at any time. Demo accounts delete themselves after 24 hours.
- Phone-first layout, dark mode, and iPhone HEIC photos.

## How it works
```
Phone/browser                                     Netlify Function (Express)               Free AI
───────────────                                   ──────────────────────────               ───────
photo → shrink to ≤1.2 MB JPEG ──POST /api/extract──▶ login + daily AI cap ──image──▶ Gemini 2.5 Flash
                                                       zod schema check  ◀──JSON────  (thinking off: fits 10 s)
   ◀──────── draft + maths check + duplicate? ─────── normalise (dates, amounts, category)
edit → Save ──────────────POST /api/receipts──────▶ MongoDB Atlas (text only)

AI busy (503)? → tesseract.js OCR on the phone → POST /api/extract {ocrText} → Groq Llama 3.3 → same JSON
```
The receipt maths (check, split, duplicate fingerprint, CSV) lives in one dependency-free module,
[`shared/receipt.js`](shared/receipt.js). The server and the browser both use it, so the warning you see
while editing is the same check the server stores.

## Measured results
Accuracy on 30 public CORD v2 receipts is measured with [`scripts/eval.mjs`](scripts/eval.mjs). The
results go in `docs/eval-results.md`. *(Not run yet: this needs a real Gemini key. No numbers are shown until
there is a real run.)*

## Key decisions
- **Express on Netlify Functions** (`serverless-http`): the same code runs locally with `node`. Every call
  finishes within ~10 s, so Gemini's "thinking" is switched off for photo reads.
- **The AI only drafts; you decide.** Nothing is saved until you press Save. Text on the photo is treated as
  data, and the prompt tells the model to ignore any instructions written on it.
- **Free AI only**: Gemini for photos, Groq/OpenRouter for text, per-user daily caps, and identical photos
  answered from a 7-day cache (keyed by a SHA-256 of the image).
- **Large uploads are only accepted after login.** The 5 MB body parser runs on one route, after the auth
  check. Everything else is limited to 1 MB.

## Run locally
```bash
npm install
npm run dev        # API on :8888 + web on :5173. No keys needed: in-memory DB + fake AI
npm test           # 27 API + logic tests (in-memory MongoDB, fake AI)
npm run test:e2e   # Playwright: demo → scan → maths check → split → save → chart (desktop + phone)
node scripts/eval.mjs   # accuracy run (needs GEMINI_API_KEY)
```

## Environment variables
See [`.env.example`](.env.example). `MONGODB_URI` and at least `GEMINI_API_KEY` are needed for the live site.

## Credits
Inspired by [bhimrazy/receipt-ocr](https://github.com/bhimrazy/receipt-ocr). This is an independent
implementation. Evaluation data: [CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)
(CC BY 4.0).

## License
MIT
