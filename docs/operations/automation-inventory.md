---
title: Automation inventory and Foundry evidence contract
description: Auth-safe health, sanitized API evidence, provider cost/degradation, background-job lifecycle, storage ownership, and maintenance-only authority for the Free AI gateway. Consumed by the Foundry coverage audit.
---

# Automation inventory and Foundry evidence contract

> Project-side contract for the **`ai-infrastructure-toolbox-automation`**
> capability. Code is authoritative for behavior; this page records the
> sanitized evidence and recovery ownership consumed by Foundry. The central
> capability specification moves with the Foundry control plane and is not
> duplicated here.

Free AI is **maintenance-only** Toolbox infrastructure. This inventory exists
so fleet automation can verify auth, provider, cost, storage, and
background-path health without spending provider tokens, logging private
payloads, or expanding product scope.

## Maintenance-only authority

| Action | Allowed without approval | Requires approval |
| --- | --- | --- |
| Read-only health/analytics/metadata probes | yes | — |
| Bounded retry within existing routing policy | yes (already enforced in code) | — |
| Registry-approved idempotent re-runs | yes | — |
| Rotate credentials, change providers, change spend/quota caps | no | yes |
| Change rate limits, data schema, or D1 migrations | no | yes |
| Production deploy | no (manual `cloudflare-deploy.yml` workflow_dispatch) | yes |
| New public claim or product surface | no | yes |

Automation MUST record a PR + pending deploy approval when a critical patch
passes checks. It MUST NOT deploy, migrate, or rotate credentials.

## APIs, Workers, and auth

| Surface | Route | Auth | Sanitized evidence |
| --- | --- | --- | --- |
| Gateway chat | `POST /v1/chat/completions` | `GATEWAY_API_KEY` (Bearer or `x-api-key`); hashed alternates via `GATEWAY_API_KEY_HASHES` | `x-gateway-attempts`, `x-degraded-mode` headers; no prompt/completion echo |
| Responses shim | `POST /v1/responses` | same | returns an error directing to chat completions (no streaming) |
| Debug replay | `POST /v1/debug/replay` | same | replays sanitized routing metadata only |
| Embeddings | `POST /v1/embeddings` | same | provider/latency/class only |
| Audio transcriptions | `POST /v1/audio/transcriptions` | same | provider/latency class |
| Audio speech-to-speech | `POST /v1/audio/speech-to-speech` | same | provider/latency class |
| Audio speech (TTS) | `POST /v1/audio/speech` | same | provider/latency class |
| Images | `POST /v1/images/generations` | same | provider/latency class |
| Videos | `POST /v1/videos/generations`, `GET /v1/videos/generations/{id}` | same | provider/latency class |
| Models list | `GET /v1/models` | **public read-only allowlist** | model id + provider only |
| Health | `GET /health` | **public** | per-model attempts, success_rate, avg/p90/p99 latency, cooldown_until, headroom, daily_used, daily_limit — no prompts |
| Routing status | `GET /v1/routing/status` | public read-only | per-provider available/cooldown/exhausted/degraded counts, fallback order |
| Routing config | `GET /v1/routing/config` | public read-only | scoring weights, cooldown constants, `retry.max_attempts`, degradation thresholds |
| Provider quotas | `GET /v1/provider-quotas` | public read-only | per-provider `status: ok\|exhausted\|unknown`, `limitRemaining`, `usage`, `freeDailyLimit` |
| Stats | `GET /v1/stats/providers` | public read-only | provider request/success/fail aggregates + quotas |
| Budget | `GET /v1/budget` | public read-only | Workers AI Neuron daily used/limit/reset |
| Analytics | `GET /v1/analytics` | public read-only | per-day/provider/model/project request/success/fail aggregates |
| Routing ledger | `GET /v1/routing/ledger` | public read-only | `privacy: { stores_prompt_text: false, stores_request_ids: false }`; by_prompt_class/by_outcome/by_model/by_quota_signature |
| Dashboard / benchmark / operator UI | `GET /v1/dashboard`, `/v1/benchmark`, `/benchmark`, `/dashboard`, `/live`, `/models` | public read-only (operator UI HTML) | no private data |

**Fail-closed auth:** token-spending `/v1/*` mutation routes return `503` when
`GATEWAY_API_KEY` is missing and `401` on invalid keys. Read-only allowlist:
`/v1/models`, `/v1/stats/providers`, `/v1/analytics`, `/v1/dashboard`,
`/v1/budget`, `/health`, `/v1/routing/status`, `/v1/routing/config`,
`/v1/provider-quotas`, `/v1/routing/ledger`, `/v1/benchmark`,
`/v1/benchmark/optimizer`.

`project_id` is required on all mutation `/v1/*` routes; empty string does not
work.

## Providers, routing, and cost

| Provider class | Members | Required env | Free-tier posture |
| --- | --- | --- | --- |
| Text chat | `workers_ai`, `groq`, `gemini`, `openrouter`, `cerebras`, `sambanova`, `nvidia`, `github_models`, `pollinations`, `cohere`, `mistral`, `zai`, `modelscope`, `siliconflow` | per-provider API key | free tiers; Workers AI is **fallback-only**; ModelScope seed is disabled; SiliconFlow has no routing candidate |
| Embedding | `workers_ai`, `gemini`, `voyage_ai` | per-provider API key | free tiers |
| Image / video / TTS / STT | `together`, `workers_ai`, `pollinations`, `gemini`, `nvidia`, `groq` | per-provider API key | free tiers |

**Routing policy** (`/v1/routing/config`):

- Scoring weights: `success_rate 0.6`, `headroom 0.2`, `latency 0.15`,
  `reasoning_fit 0.05`, `priority 0.02`.
- Evaluation weight range: `[0.8, 1.2]`.
- Cooldown: single retriable failure → 45s; burst (7 failures in 10s) → 120s.
- Retry: `max_attempts: 2` per request (bounded; no unbounded loop).
- Degradation thresholds: `success_rate < 0.75`, `latency > 5000ms`, or
  `short_retriable_failures >= 1` → provider marked `degraded`.
- Per-request cost budget: chat `maxAttempts: 2, maxTotalTimeoutMs: 180_000`;
  embeddings `maxAttempts: 1, maxTotalTimeoutMs: 30_000`; image
  `maxAttempts: 3, maxTotalTimeoutMs: 180_000`; TTS `maxAttempts: 1,
  maxTotalTimeoutMs: 30_000`.

**Workers AI Neuron budget** — the sole fleet-wide AI spend chokepoint:

- Hard cap: **9,500 Neurons/day** (500 buffer below the 10k/day free quota).
- `pnpm audit:cloudflare-costs` gates deploys.
- `/v1/budget` exposes `daily_used`, `daily_limit`, reset time.
- Never raise the cap or move Workers AI ahead of external providers in
  routing rank.

**Provider degradation vs outage** (`/v1/routing/status` per-provider
`status`):

- `available` — healthy and selectable.
- `degraded` — success_rate/latency/retriable-failure threshold crossed; still
  routable but deprioritized.
- `cooldown` — temporary cooldown after retriable failure or burst.
- `exhausted` — quota rejected (`/v1/provider-quotas` reports `exhausted`);
  not routable until reset.

A single provider exhausting quota is **degradation**, not total gateway
failure. Total gateway failure is when *no* provider in the routable registry
is `available`. The Foundry snapshot MUST distinguish the two.

## Background and index lifecycle

Free AI runs **no scheduled/queued ingestion**. There is no `[triggers]` /
`scheduled` handler in `wrangler.toml` and no Queue/Workflow binding. The
only background work is:

| Job | Trigger | Bounds | Timeout | Concurrency | Retries | Idempotency | Failure state | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Per-request provider fallback | inbound request | `max_attempts: 2` | per-route cost budget | per-isolate | bounded by routing policy | request-scoped (no durable job) | `x-degraded-mode` header + routing ledger | gateway runtime |
| Health state aggregation | `HealthStateDO` Durable Object | per-model rolling window | DO alarm | single DO per model key | n/a (state machine) | DO is the source of truth | cooldown / exhausted flags | `src/state/health-do.ts` |
| IP rate limiting | `IpRateLimitDO` | per-IP token bucket | DO alarm | single DO per IP | n/a | DO is the source of truth | `429` + `Retry-After` | `src/state/ip-rate-limit-do.ts` |
| Neuron budget accounting | `NeuronBudgetDO` | 9,500 Neurons/day | DO alarm | single DO | n/a | DO is the source of truth | `503` when cap exhausted | `src/state/neuron-budget.ts` |
| CI gate | GitHub Actions `ci.yml` | push/PR | job-level | 1 concurrent | n/a | n/a | red CI | `.github/workflows/ci.yml` |
| Weekly quality | GitHub Actions `weekly.yml` | `0 9 * * 1` | job-level | 1 | n/a | n/a | yellow check | `.github/workflows/weekly.yml` |
| Daily provider health | GitHub Actions `provider-health.yml` | `20 4 * * *` | three public reads | 1 | n/a | fixed issue title | red check + maintained issue | `.github/workflows/provider-health.yml` |
| Weekly provider resync | GitHub Actions `check-models.yml` | `0 9 * * 0` | 12 official catalogs + optional one tiny replay/provider | 1 | n/a | fixed issue title | red check + report/patch artifact | `.github/workflows/check-models.yml` |
| Monthly provider landscape | GitHub Actions `provider-landscape.yml` | `40 8 1 * *` | one issue/month | 1 | n/a | UTC month in title | review issue | `.github/workflows/provider-landscape.yml` |
| Production deploy | GitHub Actions `cloudflare-deploy.yml` | `workflow_dispatch` only | job-level | 1 per ref | n/a | n/a | blocked deploy | manual |

**Freshness:** health state is a rolling per-model window maintained by
`HealthStateDO`; `/health` reflects the latest window. Analytics/routing
ledger are written per request and queried by date. There is no scheduled
recompute to go stale. The Foundry snapshot treats `/health` as
fresh-as-of-the-last-request per model; a model with zero recent attempts
reports `attempts: 0` and is not falsely healthy.

## Storage ownership and recovery

| Store | Binding | Owner | Authoritative source | Backup / export / reconstruction | Migration guard | Last verification |
| --- | --- | --- | --- | --- | --- | --- |
| D1 `free-ai-gateway-db` | `GATEWAY_DB` | this Worker | migrations `0001`–`0006` | Cloudflare D1 dashboard export; schema is reconstructable from `migrations/`; analytics/ledger rows are aggregate and rebuild from live traffic, not backfill | `pnpm typecheck` + `pnpm test` gate; `wrangler d1 migrations apply` is manual | `pnpm test:coverage` in CI |
| KV `HEALTH_KV` | `HEALTH_KV` | this Worker | `HealthStateDO` writes | ephemeral health cache; reconstructable from D1 + live provider probes | n/a (cache) | `/health` live |
| Durable Object `HEALTH_DO` | `HEALTH_DO` | this Worker | per-model state machine | rebuilds from live traffic | DO migration tags `v1`, `v2` | `/health` live |
| Durable Object `RATE_LIMIT_DO` | `RATE_LIMIT_DO` | this Worker | per-IP token bucket | ephemeral; rebuilds from live traffic | DO migration tag `v1` | `429` behavior |
| Durable Object `NEURON_BUDGET` | `NEURON_BUDGET` | this Worker | daily Neuron counter | resets daily; no backfill needed | DO migration tag `v2` | `/v1/budget` live |
| Workers AI binding | `AI` | this Worker | Cloudflare | n/a (managed service) | n/a | `/v1/budget` live |
| Operator key hashes | `ops/gateway-key-hashes.local.json` (gitignored) | operator | `GATEWAY_API_KEY_HASHES` secret | `pnpm keys:upload` from local manifest | pre-push secret scan | `pnpm keys:list` |

**Private data exclusion:** the gateway stores **no prompts, completions,
authorization headers, or request bodies**. Routing ledger and analytics are
aggregate counters keyed by sanitized prompt class / model / provider /
project_id. Foundry snapshots MUST NOT copy operator key hashes or any
credential-shaped value.

## Deploy path

- **Target:** Cloudflare Worker `free-ai-gateway`, custom domain
  `ai-gateway.sassmaker.com`.
- **Trigger:** manual `cloudflare-deploy.yml` workflow_dispatch only. `main`
  is releasable and green but is **not** an automatic production trigger.
- **Pre-deploy gate:** `pnpm audit:cloudflare-costs` (cost guardrail).
- **Post-deploy smoke:** `curl /health` in the workflow.
- **Never** run `wrangler deploy` or `pnpm deploy` from an agent session.

## Foundry evidence contract

The Foundry coverage audit (`pnpm fleet:ai-infra-audit` in `saas-maker`)
reads this inventory and the live routes below to emit a sanitized snapshot.
The snapshot contains **only**: route name, HTTP status, provider class,
latency bucket, error category, quota/degradation flag, daily budget
utilization, storage ownership, and recovery owner. It contains **no**
prompts, completions, retrieved chunks, authorization headers, operator key
hashes, or any credential-shaped string.

| Contract field | Source | Freshness window |
| --- | --- | --- |
| `auth_safe_health` | `GET /health` (public, no provider tokens) | per-request rolling |
| `structured_api_evidence` | `GET /v1/routing/ledger` (`privacy.stores_prompt_text: false`) | per-day |
| `provider_cost_and_degradation` | `GET /v1/provider-quotas` + `GET /v1/budget` + `GET /v1/routing/status` | per-request |
| `background_and_index_lifecycle` | this page (no scheduled jobs; per-request fallback only) | n/a |
| `storage_ownership_and_recovery` | this page table | per-deploy |
| `maintenance_only_authority` | this page table | per-deploy |

## Accepted exceptions and blockers

- **`/v1/responses` streaming** is not implemented; returns an error directing
  to chat completions. Not an automation gap.
- **Public self-serve key issuance** is deferred (`AUTO_ISSUE_KEYS=false`).
  Examples require operator-provisioned keys.
- **Additional provider quota pollers** are deferred unless a provider exposes
  an official cheap/free quota status endpoint. Only `openrouter` is polled
  today (`QUOTA_POLLING_PROVIDERS`).
- **`src/index.ts` monolith** is intentional until route groups have focused
  test coverage; not an automation gap.
