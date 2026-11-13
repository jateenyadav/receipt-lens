import { test, expect } from '@playwright/test';

test('demo → scan a bill → maths check → split → save → list → insights, no console errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Snap a bill/ })).toBeVisible();
  await page.screenshot({ path: `test-results/landing-${info.project.name}.png`, fullPage: true });
  // Use the sample receipt on the landing page as the "photo" (the local fake AI answers for any image).
  const photo = await page.locator('.receipt-paper').screenshot();

  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Snap the whole bill')).toBeVisible();
  await page.getByTestId('upload-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: photo });

  await expect(page.getByPlaceholder('Shop or restaurant name')).toHaveValue('Spice Route Restaurant');
  await expect(page.getByText('The maths checks out')).toBeVisible();
  await page.screenshot({ path: `test-results/editor-${info.project.name}.png`, fullPage: true });

  // Break the total → warning → fix with one click.
  await page.getByLabel('Total', { exact: true }).fill('950');
  await expect(page.getByText('The numbers don’t add up')).toBeVisible();
  await page.getByRole('button', { name: /Use calculated total/ }).click();
  await expect(page.getByText('The maths checks out')).toBeVisible();

  await page.getByRole('button', { name: 'Split this bill' }).click();
  await page.getByRole('button', { name: '+ Add person' }).click();
  await expect(page.getByTestId('split-result')).toContainText('₹304.67');
  await page.getByRole('radio', { name: 'By what each had' }).click();
  await expect(page.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', /wa\.me/);
  await page.screenshot({ path: `test-results/split-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Save receipt' }).click();
  await expect(page.getByTestId('receipt-list')).toContainText('Spice Route Restaurant');
  await page.screenshot({ path: `test-results/list-${info.project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: 'Insights' }).last().click();
  await expect(page.getByRole('heading', { name: 'Spending by month' })).toBeVisible();
  await expect(page.locator('table')).toContainText('Food & Dining');
  await page.screenshot({ path: `test-results/insights-${info.project.name}.png`, fullPage: true });

  expect(errors).toEqual([]);
});
