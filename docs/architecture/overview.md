# Architecture Overview

The gateway is a single Cloudflare Worker that routes OpenAI-compatible requests
across free-tier LLM providers with health-aware selection. This page documents the
*why* behind the design; for the *what*, read `src/` and
[`architecture/decisions/`](decisions/).

## Request flow

```
inbound request
  → IpRateLimitDO.consume()        # per-IP token bucket (10 burst / ~20 rpm)
  → parse + Zod validate           # @hono/zod-openapi
  → auth (GATEWAY_API_KEY / hashes)
  → build model registry from present API keys
  → HealthStateDO.snapshot()       # success rate, latency, cooldown, daily headroom
  → deriveRequiredCapabilities()   # tools / json / vision / minContextWindow
  → selectCandidates()             # score + rank + hard-filter
  → p-retry loop over providers    # x_gateway.attempts counts tries
  → recordAnalytics() + healthRecord()  # skipped on /v1/replay
  → OpenAI-format response + x_gateway metadata
```

Every response carries `x_gateway: { provider, model, attempts, reasoning_effort,
request_id }`. The retry loop is what makes the free tier usable: a single 429 from
Groq does not fail the request — the next-best healthy candidate is tried
immediately.

## Scoring formula

```
coreScore = successRate×0.6 + headroom×0.2 + latencyScore×0.15
          + reasoningFit×0.05 + priority×0.02
finalScore = coreScore × (0.8 + blendedEval×0.4)   # eval weight clamped to [0.8, 1.2]
```

- `successRate` dominates because free-tier reliability variance is the primary
  signal — a fast model that 429s half the time is worse than a slower reliable one.
- `headroom` catches a model about to hit its daily cap *before* the first failure.
- The eval multiplier range `[0.8, 1.2]` is intentional: no eval can fully block a
  healthy model or override health/cooldown filters. See
  [`src/router/evaluation-weights.ts`](../../src/router/evaluation-weights.ts).
- Weights are static constants, not learned. Retuning requires a code deploy.

See [ADR-002](decisions/adr-001-007.md) for the
full rationale and alternatives considered.

## Capability filtering

`deriveRequiredCapabilities()` runs *before* scoring and produces a hard filter:

| Request signal | Required capability |
| --- | --- |
| `tools` array | `toolCalling` |
| `response_format: { type: "json_object" }` | `jsonMode` |
| image content in messages | `vision` |
| message length | `minContextWindow` (chars/4 + overhead, +20% buffer) |

If no candidate satisfies the filter, the gateway returns `503` rather than silently
routing to an incapable model that would 400 at the provider and burn a health
record. See [ADR-005](decisions/adr-001-007.md).

Provider capability metadata is not always trustworthy — GitHub Models advertises
vision for GPT-5/o3/o4-mini but the proxy rejects `image_url` at runtime. An explicit
denylist (`GITHUB_MODELS_IMAGE_INCOMPATIBLE`) overrides the flag.

## State layer

| Component | Role | Why a DO |
| --- | --- | --- |
| `HealthStateDO` (global, single instance) | per-model success/latency/cooldown + 100-entry history ring | atomic append+trim across concurrent requests; KV lacks CAS |
| `IpRateLimitDO` (one per IP) | token bucket, 24h inactivity alarm deletes instance | per-IP atomic consume |
| `NeuronBudgetDO` (global) | UTC-day Workers AI neuron spend, hard cap 9,500/day | atomic increment, 500-unit buffer below 10k free allocation |
| `HEALTH_KV` | debounced health snapshot (30s alarm), 5-min TTL | lets dashboard/stats skip the DO under load |

The `HealthStateDO` is a single global instance — a potential bottleneck at high
load, but acceptable at current traffic. Splitting by provider would require a
key-routing layer. See [ADR-001](decisions/adr-001-007.md)
and [ADR-007](decisions/adr-001-007.md).

DO in-memory state requires explicit cold-start hydration: the first call does a
full `ctx.storage.list()` bulk load; per-key reads on every request would be 5–10x
more storage ops.

## Workers AI is intentionally last

`fallbackRank()` in `select-model.ts` returns `1` for `workers_ai` vs `0` for
everything else. Workers AI Neurons are a billed Cloudflare resource; every other
provider is free to the gateway. Workers AI is a fallback, not a peer. The same
pattern applies to image/audio/video modality registries. Every Workers AI path must
debit `NeuronBudgetDO` before calling `env.AI.run()`.

## Auth model

- Legacy `GATEWAY_API_KEY` (plaintext secret) still supported.
- `GATEWAY_API_KEY_HASHES` — comma/newline-separated `label:sha256hex` entries;
  hash-only provisioning via `ops/gateway-key-hashes.local.json`.
- `project_id` required on all mutation routes (body field or
  `X-Gateway-Project-Id` header) — D1 analytics are keyed by it.
- Read-only allowlist (no auth): `/v1/models`, `/v1/stats/providers`,
  `/v1/analytics`, `/v1/dashboard`, `/v1/budget`, `/health`, `/v1/routing/status`.
- Token-spending routes fail closed with `401` when auth is missing/invalid.

See [`operations/gateway-key-ops.md`](../operations/gateway-key-ops.md) for the
operator key-ring workflow.

## Monolithic `src/index.ts`

`index.ts` is ~114KB / 4000+ lines and contains all Hono route handlers. This is a
known, intentional trade-off — see
[ADR-003](decisions/adr-001-007.md).
Splitting is deferred until route groups have focused test coverage. Hono's
`createRoute` + `app.openapi(...)` pattern makes it easy to split into sub-apps
later without runtime behavior change.

## Public vs. internal surfaces

| Surface | Audience | Rendered by |
| --- | --- | --- |
| `site/src/content/docs/` (Starlight MDX) | End users | Starlight site at `ai-gateway.sassmaker.com` |
| `docs/` (this tree) | Maintainers + agents | Blume (presentation) + raw markdown |
| `README.md` | End users + operators | GitHub render |
| `AGENTS.md` | Agents | Agent tooling |
| `STATUS.md` | Maintainers | Raw markdown |

The public API reference and this knowledge tree are *different documents for
different audiences* — they are not duplicated content.
