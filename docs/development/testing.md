# Testing

## Commands

```bash
pnpm test                 # vitest run (unit)
pnpm test:watch           # vitest watch
pnpm test:coverage        # vitest run --coverage (enforces thresholds)
pnpm test:e2e             # playwright (local mock e2e)
pnpm test:e2e:live        # playwright against the live deployed gateway
pnpm check                # audit:cloudflare-costs + typecheck + test
pnpm test:all             # check + test:e2e
```

## Unit tests (Vitest)

Uses `@cloudflare/vitest-pool-workers` so tests run inside the Workers runtime with
access to Durable Objects, KV, and D1 stubs. Test files live in `test/` and match
`*.spec.ts` (or `*.spec.mjs` for plain Node scripts like the cost audit).

### Coverage gate

v8 coverage thresholds gate core logic modules at **80% lines/functions/statements,
70% branches**:

- `src/router/select-model.ts`
- `src/router/classify-error.ts`
- `src/auth/gateway.ts`
- `src/state/client.ts`
- `src/providers/quota.ts`

UI/config/test files are excluded from the gate. The gate is enforced in CI via
`pnpm test:coverage`. When bringing a new core module up to the threshold, add it
to the `coverage.thresholds` glob in `vitest.config.ts`.

### Known test layout

| File | Covers |
| --- | --- |
| `select-model.spec.ts` | scoring, capability filtering, fallback rank |
| `classify-error.spec.ts` | error classification (retriable / safety / fatal) |
| `auth.spec.ts` | gateway key + hash ring validation |
| `health-do.spec.ts` | HealthStateDO cooldown / history ring |
| `free-tier-guard.spec.ts` | Workers AI last-rank + neuron budget guard |
| `routing-ledger.spec.ts` | routing experiment ledger persistence |
| `routing-status.spec.ts` | public routing status endpoint |
| `provider-quota.spec.ts` | OpenRouter quota polling |
| `replay-lab.spec.ts` | debug replay skips health/analytics writes |
| `analytics-failure-recording.spec.ts` | failure recording in D1 |
| `images.spec.ts` / `videos.spec.ts` / `audio-speech.spec.ts` | multimodal routing |
| `embedding-model-smoke.spec.ts` | embedding catalog |
| `cloudflare-cost-audit.spec.mjs` | cost guardrail script |

## E2E (Playwright)

- `e2e/playground.test.ts` — mock e2e against local wrangler dev.
- `e2e-live/playground-live.spec.ts` — live smoke against the deployed gateway.
  Excluded from `tsc` (needs `@types/node`); run via
  `pnpm test:e2e:live` locally.

## Pre-push hook

`.husky/pre-push` runs `pnpm lint` (Biome) and a secret-pattern scan across tracked
files. A match aborts the push. The scan excludes `.example`, `.sample`, test,
fixture, mock, and vendor paths.

## Adding a new core module to the coverage gate

1. Write tests until coverage hits 80/80/80/70.
2. Add the path to the coverage threshold glob in `vitest.config.ts`.
3. Run `pnpm test:coverage` to confirm the gate passes.
