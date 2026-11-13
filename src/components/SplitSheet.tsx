import { useEffect, useMemo, useRef, useState } from 'react';
import { money, splitBill, splitMessage, type Receipt } from '../../shared/receipt.js';

type Props = { receipt: Receipt; onClose: () => void };

export default function SplitSheet({ receipt, onClose }: Props) {
  const [people, setPeople] = useState<string[]>(['Me', 'Friend 1']);
  const [mode, setMode] = useState<'equal' | 'items'>('equal');
  const [assign, setAssign] = useState<number[][]>(() => receipt.items.map(() => []));
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const split = useMemo(() => splitBill(receipt, { people, mode, assign }), [receipt, people, mode, assign]);
  const message = useMemo(() => splitMessage(receipt, split), [receipt, split]);
  const cur = receipt.currency;

  const rename = (i: number, name: string) => setPeople((p) => p.map((x, k) => (k === i ? name : x)));
  const removePerson = (i: number) => {
    setPeople((p) => p.filter((_, k) => k !== i));
    setAssign((a) => a.map((who) => who.filter((p) => p !== i).map((p) => (p > i ? p - 1 : p))));
  };
  const toggle = (item: number, person: number) => setAssign((a) => a.map((who, k) => (k !== item ? who : who.includes(person) ? who.filter((p) => p !== person) : [...who, person])));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this message:', message);
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} className="m-auto w-[min(40rem,calc(100vw-1.5rem))] rounded-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100">
      <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold">Split this bill</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{receipt.merchant || 'Bill'} · {money(split.total, cur)}</p>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => dialog.current?.close()} aria-label="Close">✕</button>
        </div>

        <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Who was there?</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map((p, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 dark:border-slate-700 dark:bg-slate-800">
              <input className="w-24 bg-transparent text-sm font-medium outline-none" value={p} onChange={(e) => rename(i, e.target.value)} aria-label={`Person ${i + 1} name`} />
              {people.length > 1 && <button className="grid h-6 w-6 place-items-center rounded-full text-xs text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={() => removePerson(i)} aria-label={`Remove ${p}`}>✕</button>}
            </span>
          ))}
          {people.length < 20 && <button className="rounded-full border border-dashed border-brand-500 px-3 py-1 text-sm font-semibold text-brand-700 dark:text-brand-400" onClick={() => setPeople((p) => [...p, `Friend ${p.length}`])}>+ Add person</button>}
        </div>

        <div className="mt-5 inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup" aria-label="How to split">
          {(['equal', 'items'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} disabled={m === 'items' && !receipt.items.length}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40 ${mode === m ? 'bg-white shadow dark:bg-slate-950' : 'text-slate-500'}`} onClick={() => setMode(m)}>
              {m === 'equal' ? 'Split equally' : 'By what each had'}
            </button>
          ))}
        </div>

        {mode === 'items' && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Tap who had each item. Nobody tapped = shared by all. Tax and extras are shared in proportion.</p>
            {receipt.items.map((it, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                <p className="flex justify-between text-sm font-medium"><span>{it.name}</span><span className="num">{money(it.amount, cur)}</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {people.map((p, k) => (
                    <button key={k} aria-pressed={assign[i]?.includes(k) ?? false} onClick={() => toggle(i, k)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${assign[i]?.includes(k) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {p || `Person ${k + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Who pays what</h3>
        <ul className="mt-2 divide-y divide-slate-100 rounded-2xl bg-gradient-to-br from-brand-50 to-orange-50 px-4 dark:divide-slate-800 dark:from-brand-600/10 dark:to-accent-500/10" data-testid="split-result">
          {split.shares.map((s, i) => (
            <li key={i} className="flex items-center justify-between py-2.5">
              <span className="font-medium">{s.name}</span>
              <span className="num text-lg font-extrabold">{money(s.amount, cur)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button className="btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy message'}</button>
          <a className="btn bg-[#25D366] text-white hover:brightness-95" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
        </div>
      </div>
    </dialog>
  );
}
