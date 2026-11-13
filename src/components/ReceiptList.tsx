import { useCallback, useEffect, useMemo, useState } from 'react';
import { money, type Receipt } from '../../shared/receipt.js';
import { api } from '../api';
import { categoryColor } from '../lib/colors';
import Editor from './Editor';

type Saved = Receipt & { id: string; mathOk: boolean };
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function ReceiptList() {
  const [month, setMonth] = useState(thisMonth);
  const [receipts, setReceipts] = useState<Saved[] | null>(null);
  const [open, setOpen] = useState<Saved | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setReceipts((await api<{ receipts: Saved[] }>(`/receipts${month ? `?month=${month}` : ''}`)).receipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load receipts.');
      setReceipts([]);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const byCur = new Map<string, number>();
    for (const r of receipts || []) byCur.set(r.currency, (byCur.get(r.currency) || 0) + (r.total || 0));
    return [...byCur.entries()];
  }, [receipts]);

  if (open) {
    return <Editor initial={open} id={open.id} onDone={(saved) => { setOpen(null); if (saved) void load(); }} />;
  }

  return (
    <section className="space-y-4">
      <div className="card flex flex-wrap items-end justify-between gap-4 p-4 sm:p-5">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="month">Month</label>
          <div className="mt-1 flex items-center gap-2">
            <input id="month" type="month" className="field w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button className={`text-sm font-semibold ${month ? 'text-brand-700 hover:underline dark:text-brand-400' : 'text-slate-400'}`} onClick={() => setMonth(month ? '' : thisMonth())}>{month ? 'Show all' : 'This month'}</button>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Spent</p>
          {totals.length ? totals.map(([cur, t]) => <p key={cur} className="num text-2xl font-extrabold">{money(t, cur)}</p>) : <p className="num text-2xl font-extrabold">—</p>}
        </div>
        <a className="btn-ghost" href={`/api/export.csv${month ? `?month=${month}` : ''}`} download>⬇ Export CSV</a>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-rose-600">{error}</p>}
      {receipts === null ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="card h-16 animate-pulse" />)}</div>
      ) : receipts.length === 0 ? (
        <p className="card p-8 text-center text-slate-500 dark:text-slate-400">No receipts {month ? 'this month' : 'yet'}. Scan one to get started.</p>
      ) : (
        <ul className="space-y-2" data-testid="receipt-list">
          {receipts.map((r) => (
            <li key={r.id}>
              <button className="card flex w-full items-center gap-3 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-4" onClick={() => setOpen(r)}>
                <span aria-hidden className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: categoryColor(r.category) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{r.merchant || 'Unnamed shop'}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{r.date} · {r.category}{r.items.length ? ` · ${r.items.length} item${r.items.length > 1 ? 's' : ''}` : ''}</span>
                </span>
                {!r.mathOk && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="The numbers on this bill don't add up">! check</span>}
                <span className="num font-extrabold">{money(r.total, r.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
