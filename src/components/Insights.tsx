import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, money } from '../../shared/receipt.js';
import { api } from '../api';
import { categoryColor } from '../lib/colors';

type Row = { month: string; category: string; currency: string; total: number; count: number };
type Stats = { from: string; months: number; rows: Row[] };

const label = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });
const longLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function monthList(from: string, n: number) {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/** A rounded "nice" axis maximum. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= v) ?? 10 * p;
}

export default function Insights() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ month: string; category: string; total: number; x: number; y: number } | null>(null);

  useEffect(() => {
    api<Stats>('/stats?months=6').then(setStats, (e) => setError(e instanceof Error ? e.message : 'Could not load stats.'));
  }, []);

  const view = useMemo(() => {
    if (!stats) return null;
    // Show one currency: the one used most (mixed currencies can't be added up).
    const counts = new Map<string, number>();
    for (const r of stats.rows) counts.set(r.currency, (counts.get(r.currency) || 0) + r.count);
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'INR';
    const others = [...counts.keys()].filter((c) => c !== currency);
    const months = monthList(stats.from, stats.months);
    const rows = stats.rows.filter((r) => r.currency === currency);
    const byMonth = months.map((m) => {
      const parts = CATEGORIES.map((c) => ({ category: c, total: rows.filter((r) => r.month === m && r.category === c).reduce((s, r) => s + r.total, 0) })).filter((p) => p.total > 0);
      return { month: m, parts, total: parts.reduce((s, p) => s + p.total, 0) };
    });
    const used = CATEGORIES.filter((c) => rows.some((r) => r.category === c));
    return { currency, others, byMonth, used, max: niceMax(Math.max(0, ...byMonth.map((b) => b.total))) };
  }, [stats]);

  if (error) return <p role="alert" className="card p-6 text-rose-600">{error}</p>;
  if (!view) return <div className="card h-80 animate-pulse" aria-busy="true" />;

  const sel = view.byMonth.find((b) => b.month === selected) || [...view.byMonth].reverse().find((b) => b.total > 0) || view.byMonth.at(-1)!;
  const W = 640; const H = 260; const padL = 56; const padB = 28; const padT = 12;
  const plotW = W - padL - 8; const plotH = H - padB - padT;
  const slot = plotW / view.byMonth.length;
  const barW = Math.min(44, slot * 0.55);
  const y = (v: number) => padT + plotH - (v / view.max) * plotH;
  const fmtShort = (v: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const nothing = view.byMonth.every((b) => b.total === 0);

  return (
    <section className="space-y-4">
      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold">Spending by month</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Last 6 months · {view.currency}{view.others.length ? ` (bills in ${view.others.join(', ')} not shown)` : ''}</p>
        </div>

        {nothing ? (
          <p className="py-16 text-center text-slate-500 dark:text-slate-400">Save a few receipts and your spending chart appears here.</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300" aria-label="Legend">
              {view.used.map((c) => <li key={c} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: categoryColor(c) }} />{c}</li>)}
            </ul>
            <div className="relative mt-2">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Monthly spending, ${view.byMonth.map((b) => `${longLabel(b.month)} ${money(b.total, view.currency)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
                {[0, 0.5, 1].map((f) => (
                  <g key={f}>
                    <line x1={padL} x2={W - 8} y1={y(view.max * f)} y2={y(view.max * f)} stroke="var(--grid)" strokeWidth={1} />
                    <text x={padL - 8} y={y(view.max * f)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px] dark:fill-slate-400">{fmtShort(view.max * f)}</text>
                  </g>
                ))}
                {view.byMonth.map((b, i) => {
                  const cx = padL + slot * i + slot / 2;
                  let acc = 0;
                  const active = b.month === sel.month;
                  return (
                    <g key={b.month}>
                      {/* Wide invisible hit area: tap a month to see its breakdown. */}
                      <rect x={cx - slot / 2} y={padT} width={slot} height={plotH} fill="transparent" className="cursor-pointer" onClick={() => setSelected(b.month)} />
                      {active && <rect x={cx - slot / 2 + 4} y={padT} width={slot - 8} height={plotH} rx={8} className="fill-slate-100 dark:fill-slate-800/60" pointerEvents="none" />}
                      {b.parts.map((p, k) => {
                        const top = y(acc + p.total);
                        const h = Math.max(0, y(acc) - top);
                        acc += p.total;
                        const last = k === b.parts.length - 1;
                        return (
                          <path key={p.category}
                            d={last ? roundedTop(cx - barW / 2, top, barW, h, Math.min(4, h)) : `M${cx - barW / 2},${top}h${barW}v${h}h${-barW}z`}
                            fill={categoryColor(p.category)} stroke="var(--chart-gap)" strokeWidth={2} paintOrder="stroke"
                            className="cursor-pointer"
                            onMouseEnter={() => setHover({ month: b.month, category: p.category, total: p.total, x: cx / W, y: top / H })}
                            onClick={() => setSelected(b.month)} />
                        );
                      })}
                      <text x={cx} y={H - 8} textAnchor="middle" className={`text-[12px] ${active ? 'fill-slate-900 font-bold dark:fill-white' : 'fill-slate-500 dark:fill-slate-400'}`}>{label(b.month)}</text>
                    </g>
                  );
                })}
              </svg>
              {hover && (
                <div role="tooltip" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900"
                  style={{ left: `${hover.x * 100}%`, top: `calc(${hover.y * 100}% - 6px)` }}>
                  <p className="font-semibold">{hover.category}</p>
                  <p className="num">{longLabel(hover.month)}: {money(hover.total, view.currency)}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!nothing && (
        <div className="card p-4 sm:p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="font-extrabold">{longLabel(sel.month)}</h3>
            <p className="num text-xl font-extrabold">{money(sel.total, view.currency)}</p>
          </div>
          {sel.parts.length === 0 ? <p className="mt-3 text-sm text-slate-500">No spending this month.</p> : (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Spending by category in {longLabel(sel.month)}</caption>
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400"><th className="py-1 font-semibold">Category</th><th className="py-1 text-right font-semibold">Share</th><th className="py-1 text-right font-semibold">Spent</th></tr></thead>
              <tbody>
                {[...sel.parts].sort((a, b) => b.total - a.total).map((p) => (
                  <tr key={p.category} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: categoryColor(p.category) }} />{p.category}</span></td>
                    <td className="num py-2 text-right text-slate-500 dark:text-slate-400">{Math.round((p.total / sel.total) * 100)}%</td>
                    <td className="num py-2 text-right font-semibold">{money(p.total, view.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}
