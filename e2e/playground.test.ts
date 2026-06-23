import { expect, test } from '@playwright/test';

test.describe('Playground FE (mocked API)', () => {
  test('submits prompt, sends expected payload, and renders mocked response', async ({ page }) => {
    let seenRequest = false;

    await page.route('**/v1/chat/completions', async (route) => {
      seenRequest = true;

      const request = route.request();
      const headers = request.headers();
      const body = request.postDataJSON() as {
        model: string;
        prompt: string;
        stream: boolean;
      };

      expect(headers.authorization).toBe('Bearer test-key');
      expect(body).toEqual({
        model: 'auto',
        prompt: 'Explain edge runtimes briefly',
        stream: false,
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: 1,
          model: 'llama-3.1-8b-instant',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Mocked answer from test' },
              finish_reason: 'stop',
            },
          ],
          x_gateway: {
            provider: 'groq',
            model: 'llama-3.1-8b-instant',
            attempts: 1,
            request_id: 'req-mock-1',
          },
        }),
      });
    });

    await page.goto('/');
    await page.getByPlaceholder('API key').fill('test-key');
    await page
      .getByPlaceholder('Imagine a spectral conduit bridging two realities...')
      .fill('Explain edge runtimes briefly');
    await page.getByRole('button', { name: 'Generate' }).click();

    await expect.poll(() => seenRequest).toBe(true);

    // Check output view
    await expect(
      page.locator('section').filter({ hasText: 'Output' }).locator('pre')
    ).toContainText('Mocked answer from test');
    await expect(
      page.locator('section').filter({ hasText: 'Output' }).locator('pre')
    ).toContainText('"provider":"groq"');

    // Check request log
    const requestLogEntry = page
      .locator('section')
      .filter({ hasText: 'Request Log' })
      .locator('div > div')
      .first();
    await expect(requestLogEntry).toContainText('Explain edge runtimes briefly');
    await expect(requestLogEntry.getByText('200')).toBeVisible();
    await expect(requestLogEntry.getByText('groq')).toBeVisible();
  });

  test('renders mocked auth error from API', async ({ page }) => {
    await page.route('**/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: 'Unauthorized',
            type: 'auth_error',
          },
        }),
      });
    });

    await page.goto('/');
    await page.getByPlaceholder('API key').fill('bad-key');
    await page
      .getByPlaceholder('Imagine a spectral conduit bridging two realities...')
      .fill('test prompt');
    await page.getByRole('button', { name: 'Generate' }).click();

    // Check output view for error
    await expect(
      page.locator('section').filter({ hasText: 'Output' }).locator('pre')
    ).toContainText('Unauthorized');

    // Check request log for error status
    const requestLogEntry = page
      .locator('section')
      .filter({ hasText: 'Request Log' })
      .locator('div > div')
      .first();
    await expect(requestLogEntry.getByText('401')).toBeVisible();
  });
});
