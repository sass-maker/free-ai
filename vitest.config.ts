import { defineVitestConfig } from '@saas-maker/test-config/vitest';

export default defineVitestConfig({
  include: ['test/**/*.spec.ts'],
  coverage: {
    enabled: false,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
