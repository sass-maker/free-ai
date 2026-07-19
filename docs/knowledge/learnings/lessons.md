# Lessons & Gotchas

Concrete things learned from building and operating the gateway. Ordered roughly by when they surfaced.

---

## Workers AI streaming is not OpenAI-format SSE

**When:** first streaming implementation, visible in `index.ts` `processWorkersSseText` and the `workers_ai` chunk decoder path.

Workers AI's `env.AI.run()` stream emits chunks that can be raw `Uint8Array` / `ArrayBuffer`, plain strings, objects with a `response` field, or objects with a `delta.content` field — depending on whether the Worker streams via the REST API or the AI binding. Downstream clients expect OpenAI-format SSE frames (`data: {...}\n\n` with `choices[0].delta.content`).

Lesson: Workers AI needs a custom SSE translation layer. Every other provider speaks OpenAI-format SSE natively and can be forwarded with `toSseData(chunk)`. The Workers AI path requires buffering raw bytes, splitting on `\n\n`, finding the `data:` line, and re-emitting in OpenAI format.

---

## GitHub Models advertises vision but rejects image_url for some models

**When:** capability audit, baked into `select-model.ts` as `GITHUB_MODELS_IMAGE_INCOMPATIBLE`

GPT-5, GPT-5-mini, GPT-5-nano, o3, and o4-mini are listed in the GitHub Models catalog with vision capabilities. The chat completions endpoint returns a successful response structure for these models but rejects `image_url` message parts at runtime with a 400.

Lesson: Provider capability metadata is not always trustworthy. When a provider exposes models through a proxy (GitHub wrapping OpenAI endpoints), the proxy may not forward all content types. Add an explicit denylist in `supportsVisionInput()` rather than relying solely on the capabilities flag.

---

## D1 analytics does not record token/neuron consumption

**When:** documented in `free-compute-source-audit.md` (checked 2026-05-28)

`project_analytics` stores `(project_id, date, provider, model, total_requests, successful_requests, failed_requests)`. Neuron consumption is tracked only through `NeuronBudgetDO`, which resets daily and does not persist historical totals.

Lesson: Historical Workers AI cost can be bounded from request volume and the `NeuronBudgetDO` estimator, but cannot be reconstructed exactly from D1 alone. If exact token/neuron history matters later, add a column to D1 analytics before production traffic accumulates.

---

## Replay lab must skip health/analytics writes

**When:** commit `9cc83d5` — "Make provider failures replayable without polluting routing state"

The original approach for debugging provider failures was to re-send via `/v1/chat/completions` with `x-gateway-force-provider`. The problem: the normal chat path writes health records and analytics on every attempt, so a debugging session distorts the production routing state for that model/provider pair.

Lesson: Provider-level debugging needs a separate path that calls the provider directly but skips `healthRecord()` and `recordAnalytics()`. The replay lab (`/v1/debug/replay`) intentionally omits both.

---

## tsconfig was broken — no `include`, wrong workers types

**When:** commit `6d8e34f`, documented in `agents.md` ("fixed 2026-04-25")

The initial `tsconfig.json` had no `include` array, no `@cloudflare/workers-types` reference, and `noPropertyAccessFromIndexSignature` conflicted with Hono's internal patterns. The worker typechecked locally with `tsc` but errors were silently ignored.

Lesson: Workers projects need `@cloudflare/workers-types` explicitly listed under `types` in `tsconfig.json`, and `e2e-live` tests (which need `@types/node`) must be excluded from the main tsconfig because `@types/node` and `@cloudflare/workers-types` have conflicting global declarations.

---

## Hugging Face router free tier too small for gateway routing

**When:** `free-compute-source-audit.md` (2026-05-28)

Hugging Face Inference Providers has an OpenAI-compatible endpoint and exposes many provider backends (Cerebras, Groq, SambaNova, etc.) through one token. The free monthly credit is too small for any meaningful gateway routing load.

Lesson: "OpenAI-compatible" does not mean "usable as a routing backend". Evaluate actual free-tier quantum (monthly dollars or daily requests) before adding a provider to automatic routing. HF is better as a manual probe/test provider than as part of the fallback pool.

---

## OpenRouter free-model daily limit is not exposed per model

**When:** `providers/quota.ts`, comment in `fetchOpenRouterQuota`

OpenRouter's `/api/v1/key` endpoint reports `limit_remaining` for the overall account credit, but for free models (`model:free` variants) the per-model daily request cap is not surfaced through the API. `is_free_tier: true` is reported, but the actual remaining free-model quota is not queryable.

Lesson: Quota polling for OpenRouter is advisory, not precise. The gateway can detect total credit exhaustion but cannot know how many free-model requests remain today. The hardcoded `OPENROUTER_FREE_DAILY_LIMIT = 50` is a documentation artifact, not a real enforcement point.

---

## Workers AI is naturally last — explicit priority ordering required

**When:** commits `d59e721` (guarded Workers AI fallback) and `free-compute-source-audit.md`

Workers AI was initially in the routing pool at equal footing with external providers. This meant Workers AI Neurons were spent on requests that could have been served for free by Groq, Gemini, or Mistral.

Lesson: `fallbackRank()` in `select-model.ts` explicitly deprioritises `workers_ai` (returns `1` vs `0` for everything else) when no provider or model is forced. The same pattern was applied to image/audio/video modality registries. Workers AI should be last in all `model=auto` paths.

---

## DO in-memory cache requires explicit cold-start hydration

**When:** commit `3023d2c` — "cache DO state in-memory with debounced snapshot"

Before the optimization, every `/record` or `/lookup` call to `HealthStateDO` read from `ctx.storage` individually. Under any real load this produced N storage reads per request (one per candidate model key). The fix was a `cacheLoaded` boolean guard: the first call to `ensureCacheLoaded()` does one `ctx.storage.list()` to hydrate the full in-memory map; subsequent calls are pure memory reads.

Lesson: DO SQLite storage reads are cheap but not free. Bulk-load all state on first access rather than reading key-by-key. The in-memory map is valid for the lifetime of the DO instance; Workers can restart the DO between request bursts, so the cold-start path must stay correct.

---

## Short-window throttle threshold triggers faster cooldown

**When:** constants in `health-do.ts`

`HealthStateDO` maintains two cooldown triggers:
1. Any single `usage_retriable` failure starts a 45-second cooldown (`RETRIABLE_BASE_COOLDOWN_MS`).
2. If ≥7 of the last 10 attempts are `usage_retriable` failures (`SHORT_FAILURE_THRESHOLD = 7 / SHORT_WINDOW = 10`), a 120-second cooldown is applied (`COOL_DOWN_MS`).

Lesson: A single 429 does not fully cool down a model (45s is short), but repeated throttling in a burst escalates to 2 minutes. The sliding window catches sustained quota exhaustion that the base cooldown alone would keep retrying.

---

## Providers emit safety refusals as successful HTTP 200s

**When:** `isSafetyRefusal()` in `index.ts`

Some providers (e.g. Workers AI content classifiers, some OpenRouter models) return HTTP 200 with `finish_reason: content_filter` or response text containing "cannot help with" / "safety policy". These are not retryable — trying another model for a safety-refused request just burns another attempt.

Lesson: Safety refusals must be classified at the response-content level, not just HTTP status. `classifyError()` catches the `safety` / `content filter` / `refus` keywords from error messages, but the gateway also checks `isSafetyRefusal()` on successful completions before considering fallback.

---

## `project_id` is required — empty string does not work

**When:** commit `296a903` and validation in `index.ts` `projectIdSchema`

D1 analytics are keyed by `project_id`. When project_id was optional, all untagged traffic accumulated under a `null` key, making analytics useless. Making it required broke existing callers.

Lesson: Required fields are easier to reason about than optional ones when the missing case produces meaningless data. Accept via both body and `x-gateway-project-id` header so callers can set it at the SDK layer without changing every request body.
