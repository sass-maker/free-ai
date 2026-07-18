# New things to learn — free-ai

Stubs for concepts encountered building a health-aware multi-LLM gateway on Cloudflare Workers. Fill in "Why here" after learning the concept locally.

---

## Durable Objects (DO)
- What: Cloudflare Workers primitive giving a single-instance actor with strongly consistent SQLite storage and in-memory state that persists across requests to that instance.
- Why here: TBD
- Gotcha (from code): DO in-memory state requires explicit cold-start hydration — first call does a full `ctx.storage.list()` bulk load (`health-do.ts:238`); per-key reads on every request are 5-10x more storage ops.
- Source: https://developers.cloudflare.com/durable-objects/

---

## Workers AI & Neurons
- What: Cloudflare's serverless GPU inference binding (`env.AI.run()`), billed in Neurons (GPU-compute units) not tokens; free tier is 10,000 Neurons/day.
- Why here: TBD
- Gotcha (from code): Workers AI stream yields `AsyncIterable<unknown>` whose chunks may be raw `Uint8Array`, `ArrayBuffer`, plain strings, `{response}` objects, or `{delta:{content}}` — every other provider passes raw JSON chunks through untouched (`index.ts:1501`), but Workers AI requires a multi-branch translation layer (`index.ts:1469-1494`).
- Source: https://developers.cloudflare.com/workers-ai/

---

## Hono on Cloudflare Workers
- What: Lightweight HTTP router purpose-built for edge runtimes (no Node.js deps); `@hono/zod-openapi` adds Zod-typed routes and auto-generates the OpenAPI spec + Swagger UI.
- Why here: TBD
- Gotcha (from code): `@hono/zod-openapi` route registration order matters — registering an OpenAPI route after `app.get()` for the same path silently wins; the `app.doc()` and `app.openapi()` calls must precede or match the same router instance or the spec will diverge from the actual handlers (`index.ts` monolith registers both).
- Source: https://hono.dev/

---

## Multi-LLM router scoring formula
- What: Weighted scoring to rank healthy model candidates: `successRate×0.6 + headroom×0.2 + latencyScore×0.15 + reasoningFit×0.05 + priority×0.02`, then multiplied by an eval weight capped to `[0.8, 1.2]`.
- Why here: TBD
- Gotcha (from code): Eval weight range `[0.8, 1.2]` is intentional — no single eval score can fully block a healthy model or completely override health/cooldown state (`evaluation-weights.ts:21`). Formula verified at `select-model.ts:114-120`.
- Source: TBD (internal design; no external reference)

---

## Neuron budget / daily cap pattern
- What: Technique for staying under a free-tier GPU quota — track cumulative spend in a DO, hard-stop at 9,500/day (500 below the 10,000 limit), return `503 + Retry-After` when hit.
- Why here: TBD
- Gotcha (from code): The DO `/try-debit` endpoint returns HTTP 200 with `allowed: false` (not 429) — the `503` surfaces only after the caller invokes `buildBudgetExhaustedResponse()` (`neuron-budget.ts:176`). Token-to-Neuron estimates carry a 20% buffer (`neuron-budget.ts:26`, `NEURON_BUFFER = 1.2`); the 500-unit headroom absorbs estimation error, not traffic spikes.
- Source: https://developers.cloudflare.com/workers-ai/platform/pricing/

---

## DO alarm as debounced KV write
- What: Pattern where a Durable Object schedules a `storage.setAlarm()` on first write and fires a snapshot to KV only when the alarm triggers — coalescing many rapid writes into one KV put (debounce window: 30 s).
- Why here: TBD
- Gotcha (from code): Dashboard and stats routes still call the DO directly (`client.ts:50-61`, `client.ts:63-74`) — KV holds a debounced health snapshot for external consumers, not a live read path for the gateway itself. KV is also used separately for provider quota caching (`quota.ts:37,45`). Alarm handler at `health-do.ts:301-304`.
- Source: https://developers.cloudflare.com/kv/

---

## Capability-based pre-filter before scoring
- What: Hard-filtering model candidates by required capabilities (tool calling, JSON mode, vision, context window) before the scoring step, so an incapable model never reaches the provider and burns a health record.
- Why here: TBD
- Gotcha (from code): GitHub Models advertises vision for `openai/gpt-5`, `o3`, `o4-mini` but the proxy silently rejects `image_url` at runtime — capability metadata is not always trustworthy; an explicit denylist `GITHUB_MODELS_IMAGE_INCOMPATIBLE` overrides it (`select-model.ts:21-40`).
- Source: TBD (runtime-discovered provider quirk; no authoritative external source)

---

## Token-bucket rate limiter via per-IP Durable Object
- What: Per-IP rate limiting implemented as a token-bucket DO instance (`IpRateLimitDO`) — each IP gets its own DO instance, bucket state is cached in memory and persisted to DO storage, and a 24 h inactivity alarm deletes the instance to prevent unbounded growth.
- Why here: TBD
- Gotcha (from code): The bucket state is cached in `this.bucketCache` in-memory and also written to `ctx.storage` on every `/consume` call (`ip-rate-limit-do.ts:55-63`); the alarm clears both (`ip-rate-limit-do.ts:87-91`). If the DO cold-starts mid-request the in-memory cache is empty, so the first consume re-reads from storage — correct but adds one extra storage read per cold start.
- Source: https://developers.cloudflare.com/durable-objects/

---

## Provider quirk: OpenRouter free-model quota is opaque
- What: OpenRouter's `/api/v1/key` endpoint reports overall credit balance but does not surface per-model daily free-request caps; `is_free_tier: true` is set but remaining quota is not queryable.
- Why here: TBD
- Gotcha (from code): `OPENROUTER_FREE_DAILY_LIMIT = 50` (`quota.ts:4`) is a hardcoded estimate used as metadata only — the gateway detects total credit exhaustion but cannot query per-model free headroom from the API.
- Source: TBD (OpenRouter docs URL https://openrouter.ai/docs/api-reference/limits returns 404; verify at https://openrouter.ai/docs)
