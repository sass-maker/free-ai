# free-ai — PROJECT STATUS
Last updated: 2026-06-22

## Why / What

**Free AI Gateway** is an OpenAI-compatible Cloudflare Worker routing authenticated, project-scoped requests across configured free-tier AI providers with health-aware model selection, capability filtering, and aggregate analytics. Serves fleet projects (e.g. ai-game LLM via service binding) and exposes operator health/dashboard surfaces.

**Users:** Fleet app developers (`project_id` isolation); gateway operators managing key rings and provider health; public readers of routing status/models.

**Constraints:** Active scope is operator key-ring hygiene and low-risk route splitting — not stricter rate limits or public self-serve keys without abuse policy. Best-effort free tier, not SLA. `src/index.ts` remains monolithic until split has test coverage.

**IN scope:** Gateway core, operator dashboards, Astro/Starlight docs site, cost guardrails, benchmark optimizer UI.

**OUT of scope:** Public self-serve key issuance, stricter rate limiter changes without endpoint evidence, broad multi-route refactors at once.

## Dependencies

### External

- **AI providers (free tiers):** Workers AI, Groq, Gemini, OpenRouter, Cerebras, SambaNova, NVIDIA NIM, Voyage, Command Code.
- **Cloudflare:** Workers, D1 (`free-ai-gateway-db`), Durable Objects (HealthStateDO, IpRateLimitDO, NeuronBudgetDO), KV (`HEALTH_KV`), Workers AI binding.
- **Provider API keys (names only):** `GROQ_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`, `NVIDIA_API_KEY`, `COMMAND_CODE_API_KEY`, `CLOUDFLARE_WORKERS_AI_API_KEY`.
- **Gateway auth secrets:** `GATEWAY_API_KEY`, `GATEWAY_API_KEY_HASHES` (SHA-256 hash-only provisioning via `ops/gateway-key-hashes.local.json`).

### Internal (fleet)

- **ai-game:** `GATEWAY` service binding with `LLM_PROJECT_ID=ai-game`.
- **OpenAI SDK compatible** — works with LangChain, Vercel AI SDK, etc.

### Stack & commands

**Stack:** Cloudflare Workers (Hono + TypeScript + Zod + OpenAPI) + D1 analytics + Durable Objects (health, IP rate limit, Neuron budget) + KV (`HEALTH_KV`) + Workers AI binding; Astro/Starlight docs (`site/`) via `ASSETS` binding; Vitest + Playwright.

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install deps |
| `cp .env.example .env` | Local provider keys |
| `pnpm dev:local` | Sync `.dev.vars` + `wrangler dev --local` |
| `pnpm dev` | `wrangler dev --remote` |
| `pnpm deploy` | Cost audit + docs build + `wrangler deploy` |
| `pnpm check` | audit + typecheck + vitest |
| `pnpm audit:cloudflare-costs` | Pre-deploy cost guardrail check |
| `pnpm run smoke:embedding-models -- --model gemini-embedding-001` | Read-only live `/v1/models` embedding catalog smoke |
| `pnpm typecheck` / `pnpm test` | TS + Vitest |
| `pnpm test:e2e` | Playwright (local) |
| `pnpm test:e2e:live` | Live prod smoke |
| `pnpm keys:generate` / `keys:upload` | Operator hash-only key ring |
| `pnpm build:playground` | Vite playground build |

**Wrangler vars:** `WORKERS_AI_ENABLED=true`. Optional: `MODEL_EVALUATIONS_JSON`, `PLAYGROUND_ENABLED`, `AUTO_ISSUE_KEYS`.

## Timeline

- **2026-06-03** — Live smoke verified: `model: "auto"` → `mistral-small-latest`; `/v1/budget` 2 used / 9,498 remaining; OpenRouter reported exhausted — routing ranks routable providers first.
- **2026-06-21** — `/v1/models` now includes `type: "embedding"` rows for Gemini, Voyage, and Workers AI embeddings with dimensions, aliases, and `enabled` availability. This is the catalog knowledgebase uses to choose/persist vector embedding models safely. Local validation passes: `pnpm run typecheck`, `pnpm test`, and `pnpm run lint` (warnings only). After deploy, run `pnpm run smoke:embedding-models -- --model gemini-embedding-001` before deploying downstream RAG consumers.
- **2026-06-22** — Local embedding catalog rollout remains ready: `pnpm run check` passes (cost audit, typecheck, 18 Vitest files / 108 tests) and targeted embedding catalog tests pass. The deployed gateway is still stale for this rollout: `pnpm run smoke:embedding-models -- --json --model gemini-embedding-001` returns status 200 with `embedding_model_count: 0`, so downstream knowledgebase selected-model readiness must wait for a `free-ai` deploy.
- **Shipped** — Gateway core `/v1/*` routes, health-aware routing, operator dashboards, Astro/Starlight docs site, cost guardrails, benchmark optimizer UI, fleet service binding integration.
- **Ongoing** — CI `.github/workflows/cloudflare-deploy.yml` auto-deploy on push to `main`.

## Products

- **Gateway Worker:** https://free-ai-gateway.sarthakagrawal927.workers.dev — worker `free-ai-gateway`; D1 `free-ai-gateway-db` (`6e9e2880-7f07-487a-8b55-8b486be3fa32`).
- **Docs/landing (bundled):** Astro/Starlight site in `site/dist`, served via Worker `ASSETS` binding (`run_worker_first=true`) — no separate deploy.
- **Operator UI:** `/dashboard`, `/live`, `/v1/dashboard`, `/benchmark`, `/v1/benchmark`, `/models`.
- **Examples:** `examples/node-openai-sdk/`, `examples/python-openai-sdk/`.
- **Playground:** Vite build via `pnpm build:playground` (behind `PLAYGROUND_ENABLED=false` by default).

## Features (shipped)

### Gateway core — authenticated `/v1/*` routes

- `POST /v1/chat/completions` — OpenAI-compatible chat; `model: "auto"` or explicit; streaming SSE; tools, JSON mode, vision capability filtering.
- `POST /v1/responses` — OpenAI Responses API compatible (non-streaming; proxies to chat completions).
- `POST /v1/embeddings` — explicit model required (no auto); 6 models across Gemini/Voyage/Workers AI; aliases for OpenAI embedding names. `GET /v1/models` exposes the same embedding models with dimensions and provider availability.
- `POST /v1/images/generations` — image generation routing.
- `POST /v1/videos/generations` — async video submit; `GET /v1/videos/generations/{id}` poll.
- `POST /v1/audio/speech` — TTS standalone.
- `POST /v1/audio/transcriptions` — STT (Groq upstream).
- `POST /v1/audio/speech-to-speech` — STT → LLM → TTS pipeline.
- `POST /v1/debug/replay` — operator debug replay.
- All responses include `x_gateway` metadata: provider, model, attempts, reasoning_effort, request_id.

### Public read-only routes (no auth)

- `GET /health`, `GET /health/` — model health snapshots; browser → HTML dashboard, API → JSON.
- `GET /v1/models` — searchable model catalog (browser HTML / API JSON).
- `GET /v1/routing/status` — live fallback order with latency, headroom, cooldown, degraded flags.
- `GET /v1/routing/config` — routing configuration.
- `GET /v1/routing/ledger` — anonymous routing experiment ledger (`routing_ledger_rollup` D1).
- `GET /v1/provider-quotas` — provider quota poller status.
- `GET /v1/analytics` — aggregate volume/success by provider, model, project, day.
- `GET /v1/stats/providers` — provider stats for landing proof strip.
- `GET /v1/budget` — Neuron budget remaining (Workers AI).
- `GET /v1/benchmark/optimizer` — benchmark optimizer data.
- `POST /v1/benchmark/experiments` — record routing experiments.

### Architecture

- Hono app in `src/index.ts` handles all routes; Astro/Starlight site built to `site/dist`, served via `ASSETS` binding with `run_worker_first=true`.
- Auth: Bearer `GATEWAY_API_KEY` or SHA-256 hashes in `GATEWAY_API_KEY_HASHES` (`label:hex` format); all mutation `/v1/*` require valid key + `project_id`.
- Health-aware routing: `HealthStateDO` tracks success/latency/cooldown; `HEALTH_KV` snapshots; per-model daily caps.
- `IpRateLimitDO`: ~10 burst, ~20/min per IP. `NeuronBudgetDO`: Workers AI capped at 9,500 neurons/day (`NEURON_BUDGET`).
- D1 (`free-ai-gateway-db`): anonymous aggregate analytics + `routing_ledger_rollup`.
- Provider retry loop with `x_gateway.attempts` metadata; force via `X-Gateway-Force-Provider` / `X-Gateway-Force-Model` headers.

### Auth & project isolation

- Legacy plaintext `GATEWAY_API_KEY` + SHA-256 hashes in `GATEWAY_API_KEY_HASHES`.
- `project_id` in JSON body or `X-Gateway-Project-Id` header required on mutation routes.
- Fail-closed `401` when key missing/invalid on data-generating routes.
- Operator key-ring helper (`scripts/gateway-key-ring.mjs`): `pnpm keys:generate|list|print-secret|upload`; hash-only provisioning via `ops/gateway-key-hashes.local.json`.

### Health-aware routing

- `model: "auto"` picks best healthy model matching capabilities (tools, JSON mode, vision, embeddings, image, video, audio).
- `reasoning_effort` tier filtering (auto/low/medium/high).
- Provider retry/cooldown loop; exhausted providers visible but ranked after routable ones.
- Capability filtering returns `503` when no capable model available (no silent downgrade).
- Command Code provider when `COMMAND_CODE_API_KEY` configured; `command-code-mimo-v2-5` prioritized.

### Provider catalog (free tiers)

- **Workers AI:** llama-3.3-70b, deepseek-r1-32b, qwen-14b, llama-8b, gemma-7b, mistral-7b, llama-3b/1b, phi-2 (daily caps per model).
- **Groq:** llama-70b, gpt-oss-120b/20b, kimi-k2, qwen3-32b, llama4-maverick/scout, llama-8b.
- **Gemini:** 2.5-pro/flash, 2.0-flash/lite, 2.5-flash-lite.
- **OpenRouter:** free-tier models (hermes-405b, llama-70b, gpt-oss-120b, qwen variants, mistral-small, gemma3, etc.).
- **Cerebras:** gpt-oss-120b, llama-8b.
- **SambaNova:** llama-70b, deepseek-v3, qwen3-32b.
- **NVIDIA NIM:** llama-70b, deepseek-r1, qwen-32b.
- **Voyage:** embedding fallbacks (voyage-3.5-lite, voyage-3-lite).

### Durable Objects & storage

- `HealthStateDO` (v1 migration) — per-model health tracking.
- `IpRateLimitDO` (v1) — per-IP token bucket.
- `NeuronBudgetDO` (v2) — daily Workers AI neuron cap.
- `HEALTH_KV` — ephemeral health snapshots.
- D1 `GATEWAY_DB` — anonymous analytics aggregates.

### Marketing / docs site (`site/`, Astro + Starlight)

- Built into `site/dist`, served by Worker `ASSETS` — no separate deploy.
- Landing: hero, features, quickstart, provider status proof, rate-limit expectations.
- Curl-to-SDK bridge: TypeScript + Python OpenAI SDK snippets; tab switcher on landing.
- Proof strip: live free-request count from `/v1/stats/providers`, 8+ provider fallback chain, cost saved estimate.
- Explicit "Get API Key" CTA (operator-provisioned, not self-serve).
- Examples: `examples/node-openai-sdk/`, `examples/python-openai-sdk/`.

### Cost guardrails

- `docs/cloudflare-cost-guardrails.md`; `pnpm audit:cloudflare-costs` in deploy chain.
- Workers AI fallback only; `NEURON_BUDGET` 9,500/day; CPU capped 10ms; Workers Logs sampling off.
- No unused Rate Limiting binding configured.

### Tests

- Vitest with `@cloudflare/vitest-pool-workers`.
- v8 coverage thresholds gate core logic modules (`src/router/select-model.ts`, `src/router/classify-error.ts`, `src/auth/gateway.ts`, `src/state/client.ts`, `src/providers/quota.ts`): 80% lines/functions/statements, 70% branches. Run via `pnpm test:coverage`; enforced in CI. UI/config/test files are excluded from the gate.
- Playwright e2e (local + live config `playwright.live.config.ts`).
- Live smoke (2026-06-03): `model: "auto"` → `mistral-small-latest`; `/v1/budget` 2 used / 9,498 remaining.

### Examples & docs

- `docs/gateway-key-ops.md` — operator key workflow.
- `docs/README.md` — docs index.
- SDK examples with README quickstarts.

## Todo / Planned / Deferred / Blocked

### Planned

1. Seed local operator hash manifest with current `GATEWAY_API_KEY_HASHES` entries in `ops/gateway-key-hashes.local.json`; use `pnpm keys:upload` for future updates.
2. Split `src/index.ts` by low-risk route families: dashboard/status first (`operator-ui-html.ts`), then auth helpers, then provider-specific generation routes.
3. Add more provider quota pollers only where providers expose official cheap/free quota status (`src/index.ts` `/v1/provider-quotas`).
4. Decide whether `/access/request-key` should exist — until real approval/abuse policy, examples require operator-provisioned keys.
5. Bring remaining core modules up to 80/80/80/70 and add them to the coverage gate: `src/router/evaluation-weights.ts`, `src/utils/sse.ts`, `src/utils/request.ts`, `src/routing/ledger.ts`, `src/lib/telemetry.ts`, `src/state/health-do.ts`, `src/state/neuron-budget.ts`.

### Deferred

- Public self-serve key issuance (`AUTO_ISSUE_KEYS=false` by default).
- Stricter gateway rate limiter changes without endpoint-specific evidence.
- Broad refactors moving multiple route families at once.
- `src/index.ts` monolith split deferred until route groups have focused tests.

### Blocked

- `src/index.ts` remains monolithic (~3600+ lines) — intentional until split has test coverage.
- Live smoke (2026-06-03): OpenRouter reported exhausted — routing should keep exhausted providers visible but rank routable first.
- Per-IP limits (~10 burst, ~20/min) and per-model daily caps are best-effort, not SLA.
- `/v1/responses` streaming not implemented — returns error directing to chat completions.
- Playground behind `PLAYGROUND_ENABLED=false` by default.
