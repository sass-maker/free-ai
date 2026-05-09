import { definePlaywrightConfig } from '@saas-maker/test-config/playwright';

export default definePlaywrightConfig({
  testDir: './e2e',
  baseURL: 'http://127.0.0.1:4173',
  viewportMatrix: false,
  smoke: false,
  extend: {
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
      baseURL: 'http://127.0.0.1:4173',
      trace: 'retain-on-failure',
    },
    webServer: {
      command: 'vite --config playground/vite.config.ts --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  },
});
