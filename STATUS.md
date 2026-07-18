# free-ai — STATUS

Last updated: 2026-07-18

## Objective

Gateway core is shipped and stable. Active work is operator key-ring hygiene and
low-risk route splitting. Best-effort free tier, not SLA. `src/index.ts` remains
monolithic until split has test coverage.

See [`docs/current/objective.md`](docs/current/objective.md) for scope guardrails.

## Active work

- Repository knowledge system consolidation (this branch).
- Operator hash-ring seeding: mirror current `GATEWAY_API_KEY_HASHES` entries into
  `ops/gateway-key-hashes.local.json` for `pnpm keys:upload` workflow.

## Blockers

- `src/index.ts` remains monolithic (~114KB / 4000+ lines) — intentional until
  route groups have focused test coverage.
- `/v1/responses` streaming not implemented — returns an error directing to chat
  completions.

## Unresolved questions

- Should `/access/request-key` exist? Until a real approval/abuse policy exists,
  examples require operator-provisioned keys.
- Whether to add more provider quota pollers — only where providers expose
  official cheap/free quota status.

## Next steps

1. Seed local operator hash manifest with current `GATEWAY_API_KEY_HASHES` entries;
   use `pnpm keys:upload` for future updates.
2. Split `src/index.ts` by low-risk route families: dashboard/status first
   (`operator-ui-html.ts`), then auth helpers, then provider-specific generation
   routes.
3. Bring remaining core modules up to 80/80/80/70 coverage and add them to the
   coverage gate: `src/router/evaluation-weights.ts`, `src/utils/sse.ts`,
   `src/utils/request.ts`, `src/routing/ledger.ts`, `src/lib/telemetry.ts`,
   `src/state/health-do.ts`, `src/state/neuron-budget.ts`.

## Deferred

- Public self-serve key issuance (`AUTO_ISSUE_KEYS=false` by default).
- Stricter gateway rate limiter changes without endpoint-specific evidence.
- Broad refactors moving multiple route families at once.

## Key facts

- **Deploy:** manual via `cloudflare-deploy.yml` workflow_dispatch (not auto-on-push).
- **Cost guard:** `pnpm audit:cloudflare-costs` gates deploys; Workers AI capped at
  9,500 neurons/day.
- **Live URL:** `https://ai-gateway.sassmaker.com`.
- **Full feature list:** [`docs/product/features.md`](docs/product/features.md).
- **Timeline:** [`docs/current/timeline.md`](docs/current/timeline.md).
- **Architecture:** [`docs/architecture/overview.md`](docs/architecture/overview.md).
