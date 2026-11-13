// Editable form state for a receipt: numbers are kept as text while typing, converted on use.
import { parseAmount, type Receipt } from '../../shared/receipt.js';

export type ItemForm = { name: string; quantity: string; amount: string };
export type ReceiptForm = {
  merchant: string;
  date: string;
  currency: string;
  category: string;
  paymentMethod: string;
  notes: string;
  items: ItemForm[];
  subtotal: string;
  tax: string;
  extra: string;
  discount: string;
  total: string;
  source: 'ai' | 'ocr' | 'manual';
};

const str = (n: number | null | undefined) => (n == null ? '' : String(n));
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function toForm(r: Partial<Receipt>): ReceiptForm {
  return {
    merchant: r.merchant ?? '',
    date: r.date || today(),
    currency: r.currency || 'INR',
    category: r.category || 'Other',
    paymentMethod: r.paymentMethod ?? '',
    notes: r.notes ?? '',
    items: (r.items || []).map((it) => ({ name: it.name, quantity: str(it.quantity ?? 1), amount: str(it.amount) })),
    subtotal: str(r.subtotal),
    tax: str(r.tax),
    extra: str(r.extra),
    discount: str(r.discount),
    total: str(r.total),
    source: r.source || 'manual',
  };
}

export function fromForm(f: ReceiptForm): Receipt {
  return {
    merchant: f.merchant.trim(),
    date: f.date,
    currency: f.currency.trim().toUpperCase() || 'INR',
    category: f.category,
    paymentMethod: f.paymentMethod.trim() || null,
    notes: f.notes.trim(),
    items: f.items
      .filter((it) => it.name.trim() || it.amount.trim())
      .map((it) => ({ name: it.name.trim() || 'Item', quantity: parseAmount(it.quantity) || 1, amount: parseAmount(it.amount) ?? 0 })),
    subtotal: parseAmount(f.subtotal),
    tax: parseAmount(f.tax),
    extra: parseAmount(f.extra),
    discount: parseAmount(f.discount),
    total: parseAmount(f.total),
    source: f.source,
  };
}

/** Preferred currency: remembered from the last save, else from the browser's region. */
export function defaultCurrency(): string {
  try {
    const saved = localStorage.getItem('rl:currency');
    if (saved && /^[A-Z]{3}$/.test(saved)) return saved;
  } catch { /* storage blocked */ }
  const region = (navigator.language.split('-')[1] || 'IN').toUpperCase();
  const map: Record<string, string> = { IN: 'INR', US: 'USD', GB: 'GBP', ID: 'IDR', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD', JP: 'JPY' };
  return map[region] || (['DE', 'FR', 'ES', 'IT', 'NL', 'IE', 'PT', 'BE', 'AT', 'FI'].includes(region) ? 'EUR' : 'INR');
}

export function rememberCurrency(code: string) {
  try { localStorage.setItem('rl:currency', code); } catch { /* storage blocked */ }
}
