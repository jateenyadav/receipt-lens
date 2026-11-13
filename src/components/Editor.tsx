import { useMemo, useState } from 'react';
import { CATEGORIES, checkMath, itemsTotal, money, type Receipt } from '../../shared/receipt.js';
import { api } from '../api';
import { fromForm, rememberCurrency, toForm, type ItemForm, type ReceiptForm } from '../lib/form';
import SplitSheet from './SplitSheet';

export type Duplicate = { id: string; merchant: string; date: string; total: number } | null;

type Props = {
  initial: Partial<Receipt>;
  id?: string;
  duplicate?: Duplicate;
  photo?: string;
  ocrText?: string;
  onDone: (saved: boolean) => void;
};

const SOURCE_LABEL = { ai: 'Read by AI from the photo', ocr: 'Read on your phone (backup reader)', manual: 'Typed in' } as const;

export default function Editor({ initial, id, duplicate, photo, ocrText, onDone }: Props) {
  const [form, setForm] = useState<ReceiptForm>(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);

  const receipt = useMemo(() => fromForm(form), [form]);
  const cur = receipt.currency;
  const fmt = (n: number) => money(n, cur);
  const math = useMemo(() => checkMath(receipt, fmt), [receipt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReceiptForm>(k: K, v: ReceiptForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, patch: Partial<ItemForm>) => setForm((f) => ({ ...f, items: f.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }));

  const save = async () => {
    setError('');
    if (receipt.total == null) return setError('Please enter the total.');
    setBusy(true);
    try {
      await api(id ? `/receipts/${id}` : '/receipts', { method: id ? 'PUT' : 'POST', body: receipt });
      rememberCurrency(receipt.currency);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !window.confirm('Delete this receipt?')) return;
    setBusy(true);
    try {
      await api(`/receipts/${id}`, { method: 'DELETE' });
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
      setBusy(false);
    }
  };

  const money$ = (label: string, k: 'subtotal' | 'tax' | 'extra' | 'discount' | 'total', hint?: string) => (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className={`text-sm ${k === 'total' ? 'font-bold' : 'text-slate-600 dark:text-slate-300'}`}>
        {label}{hint && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{hint}</span>}
      </span>
      <input inputMode="decimal" className={`field num w-32 text-right ${k === 'total' ? 'text-base font-bold' : ''}`} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder="—" aria-label={label} />
    </label>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <section className="card receipt-paper p-4 sm:p-6" aria-label="Receipt details">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-600/15 dark:text-brand-400">{SOURCE_LABEL[form.source]}</span>
          {photo && <button className="text-xs font-semibold text-brand-700 underline dark:text-brand-400" onClick={() => setShowPhoto((s) => !s)}>{showPhoto ? 'Hide photo' : 'Compare with photo'}</button>}
        </div>
        {showPhoto && photo && <img src={photo} alt="Your receipt" className="mb-4 max-h-96 w-full rounded-xl object-contain ring-1 ring-slate-200 dark:ring-slate-700" />}
        {ocrText && form.source === 'manual' && (
          <details className="mb-4 rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800">
            <summary className="cursor-pointer font-semibold">Text found on the photo (to help you type)</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono">{ocrText}</pre>
          </details>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm font-medium">Shop
            <input className="field mt-1 text-lg font-bold" value={form.merchant} onChange={(e) => set('merchant', e.target.value)} placeholder="Shop or restaurant name" />
          </label>
          <label className="text-sm font-medium">Date
            <input type="date" className="field mt-1" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="text-sm font-medium">Category
            <select className="field mt-1" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Currency
            <input className="field mt-1 uppercase" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </label>
          <label className="text-sm font-medium">Paid by
            <input className="field mt-1" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} placeholder="UPI, card, cash…" />
          </label>
        </div>

        <h3 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Items</h3>
        <div className="space-y-2">
          {form.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_3.5rem_6.5rem_2rem] items-center gap-2">
              <input className="field" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Item" aria-label={`Item ${i + 1} name`} />
              <input inputMode="decimal" className="field num text-center" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-label={`Item ${i + 1} quantity`} />
              <input inputMode="decimal" className="field num text-right" value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} placeholder="0" aria-label={`Item ${i + 1} amount`} />
              <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" onClick={() => set('items', form.items.filter((_, k) => k !== i))} aria-label={`Remove item ${i + 1}`}>✕</button>
            </div>
          ))}
          <button className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400" onClick={() => set('items', [...form.items, { name: '', quantity: '1', amount: '' }])}>+ Add item</button>
        </div>

        <div className="mt-5 border-t border-dashed border-slate-300 pt-3 dark:border-slate-700">
          <p className="flex justify-between py-1 text-sm text-slate-500 dark:text-slate-400"><span>Items add up to</span><span className="num">{fmt(itemsTotal(receipt.items))}</span></p>
          {money$('Subtotal', 'subtotal', 'as printed, if shown')}
          {money$('Tax', 'tax', 'GST / VAT, all together')}
          {money$('Extras', 'extra', 'service, tip, delivery, round off')}
          {money$('Discount', 'discount')}
          {money$('Total', 'total')}
        </div>

        <label className="mt-4 block text-sm font-medium">Notes
          <input className="field mt-1" value={form.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
        </label>
      </section>

      <aside className="space-y-4">
        <div role="status" className={`card p-4 ${math.ok ? 'border-brand-500/40 bg-brand-50 dark:bg-brand-600/10' : 'border-amber-400/60 bg-amber-50 dark:bg-amber-500/10'}`}>
          <p className="flex items-center gap-2 font-bold">
            <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-full text-white ${math.ok ? 'bg-brand-600' : 'bg-amber-500'}`}>{math.ok ? '✓' : '!'}</span>
            {math.ok ? 'The maths checks out' : 'The numbers don’t add up'}
          </p>
          {!math.ok && (
            <>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{math.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Compare these numbers with the bill. Either the AI misread something, or the bill itself is wrong.</p>
              {math.expectedTotal != null && (
                <button className="btn-ghost mt-3 w-full" onClick={() => set('total', String(math.expectedTotal))}>Use calculated total {fmt(math.expectedTotal)}</button>
              )}
            </>
          )}
        </div>

        {duplicate && (
          <div role="alert" className="card border-sky-400/60 bg-sky-50 p-4 text-sm dark:bg-sky-500/10">
            <p className="font-bold">Already saved?</p>
            <p className="mt-1">A receipt from <b>{duplicate.merchant || 'this shop'}</b> on {duplicate.date} for {fmt(duplicate.total)} is already in your list.</p>
          </div>
        )}

        <div className="card space-y-2 p-4">
          <button className="btn-primary w-full" onClick={save} disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Save receipt'}</button>
          <button className="btn-accent w-full" onClick={() => setSplitOpen(true)} disabled={receipt.total == null}>Split this bill</button>
          <button className="btn-ghost w-full" onClick={() => onDone(false)} disabled={busy}>{id ? 'Back' : 'Discard'}</button>
          {id && <button className="w-full py-1 text-sm font-semibold text-rose-600 hover:underline" onClick={remove} disabled={busy}>Delete receipt</button>}
          {error && <p role="alert" className="text-sm font-medium text-rose-600">{error}</p>}
        </div>
      </aside>

      {splitOpen && <SplitSheet receipt={receipt} onClose={() => setSplitOpen(false)} />}
    </div>
  );
}
