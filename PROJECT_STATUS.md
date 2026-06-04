# Project Status

Last updated: 2026-06-04

## Shipped

- OpenAI-compatible Cloudflare Worker gateway at `free-ai-gateway`.
- Authenticated token-spending `/v1/*` endpoints with public read-only status, model, analytics, dashboard, provider-quota, and budget endpoints.
- Backward-compatible gateway auth: legacy plaintext `GATEWAY_API_KEY` plus additional SHA-256 hashes in `GATEWAY_API_KEY_HASHES`.
- Health-aware `model: "auto"` routing across configured free-tier providers, with capability filtering for tools, JSON mode, vision, embeddings, image, video, and audio routes.
- Aggregate anonymous D1 analytics, public dashboard, Durable Object health/rate-limit state, and Workers AI Neuron budget guard.
- Browser-first operator health and searchable model catalog surfaces on top of the existing `/health` and `/v1/models` JSON endpoints.
- Operator key-ring helper at `scripts/gateway-key-ring.mjs` for hash-only key provisioning.
- Anonymous routing experiment ledger (`routing_ledger_rollup` D1 table) with public `GET /v1/routing/ledger` and operator health UI rollup (no prompt text stored).

## Current Observations

- Live smoke on 2026-06-03 succeeded with `model: "auto"` routed to `mistral-small-latest`.
- Live `/v1/budget` on 2026-06-03 reported 2 used, 9,498 remaining, cap 9,500.
- Live `/v1/provider-quotas` on 2026-06-03 reported OpenRouter exhausted. Routing status should keep exhausted providers visible but rank routable providers first.
- `src/index.ts` remains monolithic; this is intentional for now until route groups are split with focused tests.

## Planned Next

- Seed the local operator hash manifest with the current `GATEWAY_API_KEY_HASHES` entries from secure operator records, then use `pnpm keys:upload` for future hash-ring updates.
- Split `src/index.ts` by low-risk route families: dashboard/status routes first, then auth helpers, then provider-specific generation routes.
- Add more provider quota pollers only where providers expose official cheap/free quota status without requiring paid account state.
- Decide whether `/access/request-key` should exist. Until a real approval and abuse-control policy exists, examples must require an operator-provisioned key.

## Deferred

- Public self-serve key issuance.
- Any stricter gateway rate limiter changes without endpoint-specific evidence.
- Broad refactors that move multiple route families at once.
