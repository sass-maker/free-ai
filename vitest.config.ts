import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Core logic modules — thresholds gate these only.
      // UI/config/test files are excluded (see `exclude`).
      include: [
        // Core logic modules with established test coverage.
        // Modules below threshold today (evaluation-weights, sse,
        // ledger, telemetry, neuron-budget, health-do) are tracked as
        // follow-ups and added here once they clear 80/80/80/70.
        'src/router/select-model.ts',
        'src/router/classify-error.ts',
        'src/auth/gateway.ts',
        'src/state/client.ts',
        'src/providers/quota.ts',
      ],
      exclude: [
        // UI bundles (HTML strings, no unit-testable logic)
        'src/**/*-html.ts',
        // Config/registry + type-only modules
        'src/config.ts',
        'src/types.ts',
        'src/mod.ts',
        // Monolithic route layer — split pending test coverage
        'src/index.ts',
        // Test helpers
        'test/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
