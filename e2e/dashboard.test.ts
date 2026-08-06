import { expect, test } from '@playwright/test';

test.describe('Analytics dashboard', () => {
  let browserErrors: string[];

  test.beforeEach(async ({ page }) => {
    browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await page.goto('/dashboard-fixture');
    await expect(page.getByRole('heading', { name: 'Daily gateway outcomes' })).toBeVisible();
  });

  test.afterEach(() => {
    expect(browserErrors).toEqual([]);
  });

  test('shows exact daily rates and honest zero-traffic days', async ({ page }) => {
    const dailyTable = page.getByRole('region', { name: 'Daily gateway failure rate' });
    await expect(dailyTable).toContainText('2026-08-01');
    await expect(dailyTable).toContainText('25.0%');
    await expect(dailyTable).toContainText('No traffic');
  });

  test('changes both the breakdown and daily attribution when grouped', async ({ page }) => {
    const grouping = page.getByTitle('Choose the analytics breakdown');

    await expect(page.getByRole('heading', { name: 'Daily provider attribution' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Daily grouped analytics' })).toContainText(
      'nvidia'
    );

    const modelResponse = page.waitForResponse(
      (response) => response.url().includes('group_by=model') && response.status() === 200
    );
    await grouping.selectOption('models');
    await modelResponse;
    await expect(page.getByRole('heading', { name: 'Daily model attribution' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Daily grouped analytics' })).toContainText(
      'meta/llama-4-maverick'
    );

    const projectResponse = page.waitForResponse(
      (response) => response.url().includes('group_by=project') && response.status() === 200
    );
    await grouping.selectOption('projects');
    await projectResponse;
    await expect(page.getByRole('heading', { name: 'Daily project id attribution' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Daily grouped analytics' })).toContainText(
      'ai-game'
    );
  });

  for (const width of [390, 768, 1440]) {
    test(`contains the dashboard at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
