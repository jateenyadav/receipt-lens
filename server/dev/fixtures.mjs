// Canned answers for the fake AI (local dev + tests): { 'text to look for in the prompt': reply }.
// A sample Indian restaurant bill whose maths adds up.
export const sampleReceipt = {
  isReceipt: true,
  merchant: 'Spice Route Restaurant',
  date: '12/11/2026',
  currency: 'INR',
  category: 'food & dining',
  paymentMethod: 'UPI',
  items: [
    { name: 'Paneer Tikka', quantity: 1, amount: 340 },
    { name: 'Dal Makhani', quantity: 1, amount: 290 },
    { name: 'Butter Naan', quantity: 4, amount: '₹240.00' },
  ],
  subtotal: 870,
  tax: 43.5,
  extra: 0.5,
  discount: null,
  total: '914',
};

export default {
  'NOT_A_RECEIPT': { isReceipt: false },
  'Read this receipt': sampleReceipt,
  'Rebuild the receipt': { ...sampleReceipt, total: 999 }, // OCR path: maths deliberately off
};
