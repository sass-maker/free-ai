# Failed Approaches

Approaches that were tried and rejected, with the reason. Kept so the same path is
not retried. See also [`learnings/lessons.md`](../learnings/lessons.md) for
runtime-discovered gotchas.

## Hugging Face router as a production routing backend

**Tried:** Hugging Face Inference Providers exposes an OpenAI-compatible endpoint
(`https://router.huggingface.co/v1`) covering Cerebras, Cohere, DeepInfra,
Fireworks, Groq, HF Inference, Novita, Replicate, SambaNova, Together, Z.ai through
one token.

**Why it failed:** The free monthly credit is too small for any meaningful gateway
routing load. "OpenAI-compatible" does not mean "usable as a routing backend" —
evaluate actual free-tier quantum (monthly dollars or daily requests) before adding
a provider to automatic routing.

**Current status:** Not in the routing pool. If ever re-added, gate behind
`HF_TOKEN`, keep out of `model=auto`, require an explicit tiny daily cap plus
account-credit visibility. See
[`operations/free-compute-source-audit.md`](../../operations/free-compute-source-audit.md#skip-for-production-routing-hugging-face-router).

## KV-only health state (no Durable Object)

**Tried:** Storing per-model health (success rate, cooldown, 100-entry history
ring) in KV only.

**Why it failed:** KV has no atomic multi-key transactions; last-write-wins across
concurrent Workers isolates would corrupt cooldown state. The history ring needs
atomic append + trim that KV's eventual consistency and lack of CAS cannot safely
support.

**Current status:** Replaced by `HealthStateDO` (SQLite-backed Durable Object) with
KV as a debounced read cache only. See
[ADR-001](../../architecture/decisions/adr-001-007.md).

## Workers AI at equal routing footing with external providers

**Tried:** Workers AI in the routing pool at equal priority with Groq, Gemini, etc.

**Why it failed:** Workers AI Neurons were spent on requests that could have been
served for free by non-Cloudflare providers. Workers AI is a billed Cloudflare
resource; every other provider is free to the gateway.

**Current status:** `fallbackRank()` explicitly deprioritises `workers_ai` (returns
`1` vs `0` for everything else). Same pattern applied to image/audio/video
registries. See
[`learnings/lessons.md`](../learnings/lessons.md).

## Per-key DO storage reads on every request

**Tried:** Reading each model key individually from `ctx.storage` on every
`/record` or `/lookup` call to `HealthStateDO`.

**Why it failed:** Under real load this produced N storage reads per request (one
per candidate model key). DO SQLite storage reads are cheap but not free.

**Current status:** `ensureCacheLoaded()` does one `ctx.storage.list()` bulk load on
first access; subsequent calls are pure memory reads. See
[`learnings/lessons.md`](../learnings/lessons.md#do-in-memory-cache-requires-explicit-cold-start-hydration).

## Debugging provider failures via the normal chat path

**Tried:** Re-sending via `/v1/chat/completions` with `x-gateway-force-provider` to
debug a failing provider.

**Why it failed:** The normal chat path writes health records and analytics on
every attempt, so a debugging session distorts the production routing state for
that model/provider pair.

**Current status:** `/v1/debug/replay` calls the provider directly but skips
`healthRecord()` and `recordAnalytics()`. See
[`learnings/lessons.md`](../learnings/lessons.md).

## Optional `project_id` on mutation routes

**Tried:** `project_id` optional on chat/embedding/image/video/audio routes.

**Why it failed:** When optional, all untagged traffic accumulated under a `null`
key in D1 `project_analytics`, making analytics useless.

**Current status:** `project_id` required (body field or `X-Gateway-Project-Id`
header). Accept via both so callers can set it at the SDK layer without changing
every request body. See
[`learnings/lessons.md`](../learnings/lessons.md).

## Relying on provider capability metadata for vision routing

**Tried:** Trusting the `vision` capability flag from provider catalogs (e.g.
GitHub Models listing GPT-5/o3/o4-mini as vision-capable).

**Why it failed:** GitHub Models (a proxy wrapping OpenAI endpoints) advertises
vision for these models but the chat completions endpoint rejects `image_url`
message parts at runtime with a 400. Provider capability metadata is not always
trustworthy when a provider wraps another provider's API.

**Current status:** Explicit denylist `GITHUB_MODELS_IMAGE_INCOMPATIBLE` in
`select-model.ts` overrides the flag. See
[`learnings/lessons.md`](../learnings/lessons.md).
