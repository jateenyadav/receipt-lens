import { useEffect, useState } from 'react';
import { api, type User } from './api';
import Scanner from './components/Scanner';
import ReceiptList from './components/ReceiptList';
import Insights from './components/Insights';

type Tab = 'scan' | 'receipts' | 'insights';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'scan', label: 'Scan', icon: '📷' },
  { id: 'receipts', label: 'Receipts', icon: '🧾' },
  { id: 'insights', label: 'Insights', icon: '📊' },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('rl:theme');
      if (saved) return saved === 'dark';
    } catch { /* storage blocked */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('rl:theme', dark ? 'dark' : 'light'); } catch { /* storage blocked */ }
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg text-white shadow-md shadow-brand-600/30" aria-hidden>◎</span>
      <span className="text-lg font-extrabold tracking-tight">Receipt<span className="text-brand-600 dark:text-brand-400">Lens</span></span>
    </span>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('scan');
  const [dark, toggleTheme] = useTheme();
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ user: User | null }>('/auth/me').then((d) => setUser(d.user), () => {}).finally(() => setLoading(false));
  }, []);

  const signOut = async () => {
    await api('/auth/logout', { body: {} }).catch(() => {});
    setUser(null);
    setTab('scan');
  };

  const deleteAccount = async () => {
    const password = user?.demo ? undefined : window.prompt('Type your password to delete your account and all receipts:');
    if (!user?.demo && !password) return;
    if (user?.demo && !window.confirm('Delete this demo account and its receipts?')) return;
    try {
      await api('/auth/account', { method: 'DELETE', body: { password } });
      setUser(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.');
    }
  };

  const themeButton = (
    <button className="grid h-9 w-9 place-items-center rounded-xl text-lg hover:bg-white/70 dark:hover:bg-slate-800" onClick={toggleTheme} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀️' : '🌙'}</button>
  );

  if (loading) return <div className="grid min-h-dvh place-items-center"><Logo /></div>;
  if (!user) return <Landing onUser={setUser} themeButton={themeButton} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-24 sm:pb-8">
      <header className="flex items-center justify-between gap-3 py-4">
        <Logo />
        <nav className="hidden rounded-2xl bg-white/80 p-1 shadow-sm ring-1 ring-slate-200 sm:flex dark:bg-slate-900/80 dark:ring-slate-800" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === t.id ? 'bg-brand-600 text-white shadow' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          {themeButton}
          <details className="relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-sm font-semibold hover:bg-white/70 dark:hover:bg-slate-800">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-400">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="hidden sm:inline">{user.demo ? 'Demo' : user.name}</span>
            </summary>
            <div className="card absolute right-0 z-20 mt-2 w-56 p-2 text-sm">
              {user.demo && <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Demo account: everything is deleted after 24 hours.</p>}
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={signOut}>Sign out</button>
              <button className="w-full rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={deleteAccount}>Delete account</button>
            </div>
          </details>
        </div>
      </header>

      {error && <p role="alert" className="mb-3 text-sm font-medium text-rose-600">{error}</p>}
      <main className="flex-1">
        {tab === 'scan' && <Scanner onSaved={() => setTab('receipts')} />}
        {tab === 'receipts' && <ReceiptList />}
        {tab === 'insights' && <Insights />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/95" aria-label="Main">
        <div className="grid grid-cols-3">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${tab === t.id ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
              <span className="text-xl" aria-hidden>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Landing({ onUser, themeButton }: { onUser: (u: User) => void; themeButton: React.ReactNode }) {
  const [mode, setMode] = useState<'none' | 'login' | 'register'>('none');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async (path: string, body: object) => {
    setBusy(true);
    setError('');
    try {
      onUser((await api<{ user: User }>(path, { body })).user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
      <header className="flex items-center justify-between py-4"><Logo />{themeButton}</header>
      <main className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-2">
        <div>
          <p className="inline-block rounded-full bg-accent-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent-600 dark:text-accent-400">Free · No app to install</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Snap a bill.<br />
            <span className="text-brand-600 dark:text-brand-400">Get clean data.</span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-slate-600 dark:text-slate-300">ReceiptLens reads the shop, items, tax and total from a photo, checks the maths, and splits the bill with friends on WhatsApp.</p>
          <ul className="mt-6 space-y-2 text-sm">
            {['AI reads the bill in seconds', 'Maths check catches wrong totals', 'Split by what each person had', 'Monthly spending chart + CSV export'].map((f) => (
              <li key={f} className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[11px] text-white">✓</span>{f}</li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap gap-3">
            <button className="btn-accent px-6 py-3 text-base" disabled={busy} onClick={() => go('/auth/demo', {})}>Try the demo</button>
            <button className="btn-ghost px-6 py-3 text-base" onClick={() => setMode(mode === 'login' ? 'none' : 'login')}>Sign in</button>
          </div>

          {mode !== 'none' && (
            <form className="card mt-5 max-w-sm space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); void go(mode === 'login' ? '/auth/login' : '/auth/register', mode === 'login' ? { email: form.email, password: form.password } : form); }}>
              {mode === 'register' && <input className="field" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />}
              <input className="field" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
              <input className="field" type="password" placeholder="Password (8+ characters)" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              <button className="btn-primary w-full" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
              <button type="button" className="w-full text-sm text-slate-500 hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
              </button>
            </form>
          )}
          {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
        </div>

        <div className="relative mx-auto w-full max-w-sm" aria-hidden>
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand-400/30 to-accent-400/30 blur-2xl" />
          <div className="card receipt-paper rotate-2 p-6 font-mono text-sm shadow-xl">
            <p className="text-center font-bold tracking-widest">SPICE ROUTE</p>
            <p className="text-center text-xs text-slate-500">12 Nov 2026 · Table 4</p>
            <div className="my-3 border-t border-dashed border-slate-300 dark:border-slate-700" />
            {[['Paneer tikka', '340.00'], ['Dal makhani', '290.00'], ['Butter naan ×4', '240.00']].map(([a, b]) => (
              <p key={a} className="flex justify-between"><span>{a}</span><span>{b}</span></p>
            ))}
            <p className="mt-2 flex justify-between text-slate-500"><span>GST 5%</span><span>43.50</span></p>
            <p className="flex justify-between text-slate-500"><span>Round off</span><span>0.50</span></p>
            <div className="my-3 border-t border-dashed border-slate-300 dark:border-slate-700" />
            <p className="flex justify-between text-base font-bold"><span>TOTAL</span><span>₹914.00</span></p>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 p-2 font-sans text-xs font-semibold text-brand-700 dark:bg-brand-600/15 dark:text-brand-400"><span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white">✓</span>The maths checks out</div>
            <div className="mt-2 rounded-xl bg-[#25D366]/15 p-2 font-sans text-xs font-semibold text-emerald-800 dark:text-emerald-300">Asha ₹304.67 · Ravi ₹304.67 · Me ₹304.66</div>
          </div>
        </div>
      </main>
      <footer className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Built by <a className="font-semibold underline" href="https://github.com/jateenyadav">Jateen Yadav</a> · <a className="underline" href="https://github.com/jateenyadav/receipt-lens">Source code</a>
      </footer>
    </div>
  );
}
