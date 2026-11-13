import { useRef, useState } from 'react';
import type { MathCheck, Receipt } from '../../shared/receipt.js';
import { api, ApiError } from '../api';
import { defaultCurrency } from '../lib/form';
import { preparePhoto, type Photo } from '../lib/image';
import Editor, { type Duplicate } from './Editor';

type Extracted = { draft: Receipt; math: MathCheck; duplicate: Duplicate; remaining: number };
type Phase =
  | { kind: 'pick' }
  | { kind: 'working'; text: string; progress?: number }
  | { kind: 'edit'; draft: Partial<Receipt>; duplicate: Duplicate; ocrText?: string; note?: string };

const aiDown = (e: unknown) => e instanceof ApiError && (e.status === 503 || e.status === 504 || e.status === 502);

export default function Scanner({ onSaved }: { onSaved: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setError('');
    setPhase({ kind: 'working', text: 'Getting the photo ready…' });
    let p: Photo;
    try {
      p = await preparePhoto(file);
      setPhoto(p);
    } catch (e) {
      setPhase({ kind: 'pick' });
      return setError(e instanceof Error ? e.message : 'Could not open this photo.');
    }
    const currency = defaultCurrency();
    try {
      setPhase({ kind: 'working', text: 'Reading your bill with AI…' });
      const out = await api<Extracted>('/extract', { body: { image: { mimeType: p.mimeType, base64: p.base64 }, currency } });
      return setPhase({ kind: 'edit', draft: out.draft, duplicate: out.duplicate });
    } catch (e) {
      if (!aiDown(e) && !(e instanceof TypeError)) {
        if (e instanceof ApiError && e.status === 429) return setPhase({ kind: 'edit', draft: { currency }, duplicate: null, note: e.message + ' You can still type this one in.' });
        setPhase({ kind: 'pick' });
        return setError(e instanceof Error ? e.message : 'Could not read the bill.');
      }
    }
    // Backup: read the text on this device, then let a text AI rebuild the bill.
    let ocrText = '';
    try {
      setPhase({ kind: 'working', text: 'The photo AI is busy — reading the text on your phone instead…', progress: 0 });
      const { readTextOnDevice } = await import('../lib/ocr');
      ocrText = await readTextOnDevice(p.dataUrl, (progress) => setPhase({ kind: 'working', text: 'Reading the text on your phone…', progress }));
      setPhase({ kind: 'working', text: 'Making sense of the text…' });
      const out = await api<Extracted>('/extract', { body: { ocrText, currency } });
      setPhase({ kind: 'edit', draft: out.draft, duplicate: out.duplicate, note: 'Read with the backup reader. Please double-check the numbers.' });
    } catch {
      setPhase({ kind: 'edit', draft: { currency }, duplicate: null, ocrText: ocrText || undefined, note: 'The AI is busy right now, so please type this one in. The text found on the photo is shown to help.' });
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void read(f);
  };

  if (phase.kind === 'edit') {
    return (
      <div className="space-y-4">
        {phase.note && <p role="status" className="card border-amber-400/60 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">{phase.note}</p>}
        <Editor initial={phase.draft} duplicate={phase.duplicate} photo={photo?.dataUrl} ocrText={phase.ocrText}
          onDone={(saved) => { setPhase({ kind: 'pick' }); setPhoto(null); if (saved) onSaved(); }} />
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-xl">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} data-testid="camera-input" />
      <input ref={upload} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={onFile} data-testid="upload-input" />

      {phase.kind === 'working' ? (
        <div className="card flex flex-col items-center gap-5 p-8 text-center" aria-live="polite">
          {photo && <img src={photo.dataUrl} alt="" className="h-48 rounded-xl object-contain opacity-90 shadow-inner" />}
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {phase.progress == null
              ? <div className="absolute inset-y-0 w-1/3 animate-[scan_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brand-500 to-accent-500" />
              : <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all" style={{ width: `${Math.round(phase.progress * 100)}%` }} />}
          </div>
          <p className="font-semibold">{phase.text}</p>
          <style>{'@keyframes scan{0%{left:-33%}100%{left:100%}}'}</style>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-500 via-emerald-500 to-accent-500 p-6 text-white sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-wider opacity-90">New receipt</p>
            <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">Snap the whole bill</h2>
            <p className="mt-2 text-sm opacity-90">Flat on a table, good light, all four corners in the photo. The photo stays on your phone; only the text is saved.</p>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
            <button className="btn-primary py-4 text-base" onClick={() => camera.current?.click()}>📷 Take a photo</button>
            <button className="btn-ghost py-4 text-base" onClick={() => upload.current?.click()}>🖼️ Upload a photo</button>
            <button className="sm:col-span-2 text-sm font-semibold text-slate-500 hover:text-slate-800 hover:underline dark:hover:text-slate-200" onClick={() => setPhase({ kind: 'edit', draft: { currency: defaultCurrency() }, duplicate: null })}>or type a bill in by hand</button>
          </div>
          {error && <p role="alert" className="mx-5 mb-5 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        </div>
      )}
    </section>
  );
}
