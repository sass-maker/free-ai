# Deploy Runbook

Production gateway: `https://ai-gateway.sassmaker.com` (Worker `free-ai-gateway`).
Deploy is **manual** via the `cloudflare-deploy.yml` workflow
(`workflow_dispatch`), not auto-on-push. CI (`ci.yml`) still runs typecheck + tests
on every push to `main`.

## Pre-deploy checks

`pnpm deploy` chains: `audit:cloudflare-costs` → `pnpm install --frozen-lockfile`
→ `pnpm --filter @sass-maker/ai-gateway-docs build` (Starlight site) →
`wrangler deploy`.

Run locally first:

```bash
pnpm check                 # cost audit + typecheck + unit tests
pnpm audit:cloudflare-costs   # fail if NEURON_BUDGET missing or cap > 9,500
```

The cost audit (`scripts/audit-cloudflare-costs.mjs`) fails if:
- The `AI` binding lacks a `NEURON_BUDGET` binding.
- The committed neuron cap exceeds 9,500/day.
- Workers Logs sampling is enabled in committed config.
- CPU limit exceeds the Workers Free per-invocation limit.

See [`cloudflare-cost-guardrails.md`](cloudflare-cost-guardrails.md) for the full
guardrail list.

## Deploy via GitHub Actions (preferred)

1. Push to `main` (CI must pass).
2. Trigger the **Deploy Cloudflare** workflow manually in GitHub Actions.
3. The workflow runs typecheck + tests, validates `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` secrets, then `pnpm run deploy`.
4. Smoke check: `curl --fail https://ai-gateway.sassmaker.com/health`.

## Deploy via wrangler (fallback)

```bash
pnpm wrangler deploy
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.

## Post-deploy smoke

```bash
# Gateway is live
curl --fail https://ai-gateway.sassmaker.com/health

# Routing status is sane (no all-degraded)
curl -s https://ai-gateway.sassmaker.com/v1/routing/status | jq

# Embedding catalog exposed (before deploying downstream RAG consumers)
pnpm run smoke:embedding-models -- --model gemini-embedding-001

# Workers AI budget headroom
curl -s https://ai-gateway.sassmaker.com/v1/budget | jq
```

## What gets deployed

- The Worker (`src/index.ts` + all `src/` modules) → `free-ai-gateway`.
- The Starlight site build (`site/dist`) → served via the `ASSETS` binding with
  `run_worker_first = true`. No separate site deploy.
- D1 migrations are **not** auto-applied by `wrangler deploy`. Apply manually with
  `wrangler d1 migrations apply free-ai-gateway-db` when a new migration exists.

## D1 migrations

Migrations live in `migrations/` (`0001`–`0006`). Apply in order:

```bash
pnpm wrangler d1 migrations apply free-ai-gateway-db --remote
```

For local dev:

```bash
pnpm wrangler d1 migrations apply free-ai-gateway-db --local
```

## Rollback

Cloudflare Workers supports instant rollback via the dashboard or
`wrangler deployments rollback`. The previous deployment is kept and can be
promoted back immediately. There is no database rollback automation — D1 migrations
must be reversed manually if a migration breaks production.

## Secrets

Set via `wrangler secret put <NAME>`. Required production secrets:

- `GATEWAY_API_KEY` (legacy plaintext) — optional if using hash ring only.
- `GATEWAY_API_KEY_HASHES` — `label:sha256hex` newline-separated. Set via
  `pnpm keys:upload` (see [`gateway-key-ops.md`](gateway-key-ops.md)).
- Provider keys: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
  `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`, `NVIDIA_API_KEY`, `VOYAGE_API_KEY`.
- `CLOUDFLARE_WORKERS_AI_API_KEY` (REST fallback for local dev; prod uses the `AI`
  binding).

Never commit secrets. The pre-push hook scans for known secret patterns.
