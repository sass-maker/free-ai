import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

function readEnvFile(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const env: Record<string, string> = {};

    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const index = line.indexOf('=');
      if (index === -1) {
        continue;
      }

      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      env[key] = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }

    return env;
  } catch {
    return {};
  }
}

const dotEnv = readEnvFile();
const gatewayApiKey = process.env.GATEWAY_API_KEY ?? dotEnv.GATEWAY_API_KEY;
const hasGroqKey = Boolean(process.env.GROQ_API_KEY ?? dotEnv.GROQ_API_KEY);

test.describe('Live Playground Snapshot (real API data)', () => {
  test.skip(!gatewayApiKey || !hasGroqKey, 'Live snapshot requires GATEWAY_API_KEY and GROQ_API_KEY in .env');

  test('captures stable snapshot from real gateway response', async ({ page }) => {
    await page.goto('/playground');

    await page.fill('#apiKey', gatewayApiKey ?? '');
    await page.fill('#prompt', 'Reply with exactly: LIVE_SNAPSHOT_OK');
    await page.selectOption('#reasoning', 'low');
    await page.selectOption('#stream', 'false');
    await page.selectOption('#providerA', 'groq');

    await page.click('#runSingle');
    await expect(page.locator('#resultA')).toContainText('LIVE_SNAPSHOT_OK');

    await page.evaluate(() => {
      const resultEl = document.querySelector('#resultA');
      if (!(resultEl instanceof HTMLElement)) {
        return;
      }

      try {
        const parsed = JSON.parse(resultEl.innerText);
        const stablePayload = {
          model: parsed.model,
          content: parsed.choices?.[0]?.message?.content ?? '',
          x_gateway: {
            provider: parsed.x_gateway?.provider,
            model: parsed.x_gateway?.model,
            attempts: parsed.x_gateway?.attempts,
            reasoning_effort: parsed.x_gateway?.reasoning_effort,
          },
        };
        resultEl.innerText = JSON.stringify(stablePayload, null, 2);
      } catch {
        // Keep original output if parsing fails.
      }

      const apiKeyEl = document.querySelector('#apiKey');
      if (apiKeyEl instanceof HTMLInputElement) {
        apiKeyEl.value = '********';
      }
    });

    await expect(page.locator('.grid')).toHaveScreenshot('playground-live-grid.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.03,
      mask: [page.locator('#apiKey')],
    });
  });
});
