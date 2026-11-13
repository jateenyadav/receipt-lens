// Each category always keeps the same chart colour (colour follows the category, not its rank).
// Slots come from the validated palette in index.css; Travel and Other share the neutral "other".
const SLOT: Record<string, string> = {
  Groceries: 'var(--series-1)',
  'Food & Dining': 'var(--series-2)',
  Shopping: 'var(--series-3)',
  Transport: 'var(--series-4)',
  Fuel: 'var(--series-5)',
  Health: 'var(--series-6)',
  'Bills & Utilities': 'var(--series-7)',
  Entertainment: 'var(--series-8)',
};

export const categoryColor = (c: string) => SLOT[c] || 'var(--series-other)';
