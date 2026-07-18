# Architecture Decision Records

Covers decisions visible in code, git history, and operational docs. Each entry flags unconfirmed rationale as `TBD`.

---

## ADR-001 — Durable Objects for health state (not KV or D1)

**Date:** early project (circa commit `4a1658e`, formalised in `3023d2c`)

**Context:** Each gateway request needs the last-N attempt history, cooldown timestamps, and daily-usage counters for every model (~30+ keys). This data is read on every inbound request and written after every provider call.

**Decision:** Use a single global `HealthStateDO` (SQLite-backed Durable Object). Also use `IpRateLimitDO` (one DO per IP) for token-bucket rate limiting, and `NeuronBudgetDO` for the Workers AI daily Neuron cap.

**Rationale:**
- DOs provide strongly-consistent reads and writes within a single instance — no race conditions across concurrent requests updating the same model's cooldown or history ring.
- The 100-entry history ring per model needs atomic append + trim that KV's eventual consistency and lack of CAS would not safely support.
- D1 could handle it but would add a round-trip SQL query per model key per request; DO in-memory cache (`ensureCacheLoaded` on first fetch) keeps that to one storage read per cold start.
- KV is still used as a fast denormalised read cache (`HEALTH_KV`). `HealthStateDO` debounces writes to KV via a 30-second alarm (`SNAPSHOT_DEBOUNCE_MS = 30_000`) so read-heavy paths (dashboard, `/v1/models`) can skip the DO entirely.

**Alternatives considered:**
- KV only — rejected: no atomic multi-key transactions; last-write-wins across concurrent Workers isolates would corrupt cooldown state.
- D1 only — TBD: was not explicitly discussed in commits, but latency of a SQL round-trip per request per model key at routing time was the implicit concern.

**Tradeoffs:**
- Single global `HealthStateDO` is a bottleneck if load is high enough to queue requests to one DO instance. Acceptable at current traffic; splitting by provider would require a key-routing layer.
- DO SQLite storage is charged per row-write on paid plans; on Free the DO storage limit is the binding constraint.

---

## ADR-002 — Scoring formula weights

**Date:** established in `select-model.ts`; eval layer added in commit `35292dd`

**Context:** When multiple healthy candidates exist for a request, the router must rank them. The formula needs to prefer reliable, low-latency models without fully ignoring quota headroom or reasoning fit.

**Decision:** Two-layer scoring. Core score:

```
successRate×0.6 + headroom×0.2 + latencyScore×0.15 + reasoningFit×0.05 + priority×0.02
```

Then multiplied by an eval weight `0.8 + blended×0.4` (range `[0.8, 1.2]`) from optional `MODEL_EVALUATIONS_JSON`.

Eval blended score: `qualityScore×0.45 + taskSuccessRate×0.35 + freshness×0.1 + sampleConfidence×0.1`

**Rationale:**
- `successRate` dominates (60%) because routing free-tier providers means reliability variance is the primary signal; a fast model that 429s half the time is worse than a slower reliable one.
- `headroom` at 20% prevents routing into a model that is about to hit its daily limit, catching it before the first failure rather than after.
- `latencyScore` (15%) normalises `avgLatencyMs` against an 8-second ceiling; it matters but should not override reliability.
- `reasoningFit` (5%) and static `priority` (2%) are tie-breakers, not primary signals — the comment in code explicitly notes "evals as a strong nudge, not an override".
- Eval weight range `[0.8, 1.2]` ensures no eval can completely block a healthy model or fully override health/cooldown filters.
- `sampleConfidence = sampleCount / 20` saturates at 20 samples to prevent over-weighting early evals.

**Alternatives considered:**
- Pure round-robin — replaced early; added `175d802` as initial rotation but health-awareness layered on top because providers throttle at different rates.
- Equal weights — TBD: not explicitly discussed; the relative weights appear chosen by judgment rather than a tuning experiment.

**Tradeoffs:**
- Weights are static constants, not learned. If a new provider class emerges (e.g. very fast but very unreliable), retuning requires a code deploy.
- `latencyScore` uses `avgLatencyMs` not p90, so occasional high-latency outliers are smoothed away.

---

## ADR-003 — Monolithic `index.ts` (known trade-off)

**Date:** acknowledged in commit `e30e8ba` (refactor extracting dashboard HTML) and noted in `agents.md`

**Context:** As features were added (embeddings, multimodal, analytics, operator UI, auth middleware, budget guard), `index.ts` grew to ~3,645 lines (~55 KB). The file contains all Hono route handlers, middleware, and several inline helpers.

**Decision:** Keep it monolithic for now. Explicitly documented as a known TODO in `agents.md`: `# Monolithic index.ts (~55KB) — splitting is a known TODO`.

**Rationale:**
- Workers bundle the entire app into a single file at deploy time anyway; splitting into modules is a DX benefit, not a runtime requirement.
- Extraction was started (dashboard HTML moved to `dashboard-html.ts` in `e30e8ba`, operator UI extracted similarly) but the route handlers themselves remain.
- TBD: no explicit decision record was written at the time; the pattern emerged from iterative feature addition.

**Tradeoffs:**
- Hard to navigate; adding a new route requires finding the right region in a 3,600-line file.
- Hono's `createRoute` + `app.openapi(...)` pattern makes it easy to split routes into sub-apps later.

---

## ADR-004 — NeuronBudgetDO: 9,500/day cap with 500-unit buffer

**Date:** 2026-04-27, commit `5c4aef1`

**Context:** Cloudflare Workers AI is free up to 10,000 Neurons/day. Exceeding the quota triggers paid overage on Workers Paid plans. Token estimates per model call are imprecise (Cloudflare charges in GPU-compute Neurons, not tokens).

**Decision:** Hard cap at `DAILY_NEURON_CAP = 9500` (500 below quota). A `NeuronBudgetDO` tracks UTC-day-keyed cumulative Neuron spend and returns 503 + `Retry-After: secondsUntilUtcMidnight` when the cap is hit. All four Workers AI paths (chat, embed, images, STT/TTS) must call `/try-debit` before invoking `env.AI.run()`.

**Rationale:**
- 500-unit buffer chosen to absorb estimation error in the neuron cost model (text/embed estimates have 20% buffer baked in; image/audio estimates are coarser).
- DO chosen over KV counter for the same atomic-increment reason as `HealthStateDO`.
- Non-Workers-AI providers skip the budget entirely; only CF-billed GPU traffic counts.
- `/reset` endpoint is protected by `x-gateway-internal: 1` header (unreachable from the public internet) for debugging without a DO namespace wipe.

**Alternatives considered:**
- KV atomic counter — TBD: not explicit in commits, but DO was consistent with the existing state pattern.
- No cap — rejected; paid overage on a free project would be a silent surprise.

**Tradeoffs:**
- If the neuron cost estimator is consistently over-conservative, the gateway effectively gets fewer than 9,500 usable Neurons. Cost accuracy improves with per-model tuning.
- UTC midnight reset means heavy morning traffic (IST timezone = 05:30 UTC) hits a fresh cap.

---

## ADR-005 — Capability-based model selection

**Date:** derived from `deriveRequiredCapabilities` + `supportsVisionInput` in `select-model.ts`; vision routing verified 2026-04-25 per `agents.md`

**Context:** Not all models support tool calling, JSON mode, or vision inputs. A request with `tools` or `response_format: json_object` or image content in messages must be rejected if routed to an incapable model.

**Decision:** `deriveRequiredCapabilities()` inspects the request before scoring and produces a `RequiredCapabilities` struct `{ toolCalling, jsonMode, vision, minContextWindow }`. `selectCandidates()` filters the registry hard-stop before scoring — if no capable model is available, returns 503.

Additional special case: GitHub Models exposes certain models (GPT-5, o3, o4-mini) through chat completions but their endpoint rejects `image_url` message parts. These are explicitly excluded from vision routing via `GITHUB_MODELS_IMAGE_INCOMPATIBLE` set.

`minContextWindow` is estimated from message length (chars / 4 + per-message overhead) with a 20% buffer for output headroom.

**Rationale:**
- Hard filter before scoring avoids accidentally scoring and selecting a model that would 400 on the actual API call, which would burn an attempt and record a health failure.
- The GitHub Models image workaround is a documented provider-specific quirk, not a general pattern.

**Tradeoffs:**
- `minContextWindow` estimate is approximate; a very long message near the boundary could still produce a 400 at the provider.
- Capability flags in `config.ts` are manually maintained; a newly-capable model won't benefit until the registry entry is updated.

---

## ADR-006 — Hono + `@hono/zod-openapi` as the request framework

**Date:** established at project start; `@hono/zod-openapi` visible in first meaningful commits

**Context:** The worker needs an HTTP router, request validation, and ideally auto-generated OpenAPI spec + Swagger UI at `/docs`.

**Decision:** Use Hono with `@hono/zod-openapi` (`OpenAPIHono` app). All routes are typed via Zod schemas; the OpenAPI spec is auto-generated from route definitions.

**Rationale:**
- Hono is purpose-built for Cloudflare Workers: minimal overhead, no Node.js dependencies, first-class Workers streaming support.
- `zod-openapi` eliminates the need to maintain a separate OpenAPI YAML spec alongside the code.
- TBD: explicit evaluation against alternatives (itty-router, plain fetch handler) not recorded in commits.

**Tradeoffs:**
- `OpenAPIHono` adds some boilerplate per route (`createRoute` + `app.openapi(...)` pattern) vs plain `app.get(...)`.
- Swagger UI is served at `/docs` from the same worker, which is a slight bundle size cost.

---

## ADR-007 — Health snapshot fan-out via KV (dual-read path)

**Date:** formalised in `3023d2c`, visible in `health-do.ts` `persistSnapshot` + alarm

**Context:** The `HealthStateDO` is a single global DO. Routes like `/v1/models`, `/v1/stats/providers`, and the dashboard need current health data but do not need strongly consistent reads.

**Decision:** `HealthStateDO` debounces writes to `HEALTH_KV` under key `gateway-health-snapshot` with a 5-minute TTL. Dashboard and stats routes can read from KV directly, bypassing the DO. The DO is the authoritative write path; KV is a read cache.

**Rationale:**
- Avoids queueing all dashboard reads through the global DO under load.
- 5-minute TTL is sufficient staleness for a health display; routing always goes through the DO for fresh state.

**Tradeoffs:**
- Dashboard can show data up to 5 minutes stale if the DO alarm hasn't fired yet.
- If KV is unavailable, `persistSnapshot` silently no-ops (caught in `persistSnapshot` guard); routing is unaffected.
