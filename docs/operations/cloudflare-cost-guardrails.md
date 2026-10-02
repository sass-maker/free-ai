# Cloudflare Cost Guardrails

This gateway should run without surprise Cloudflare charges. The committed config is intentionally free-first:

- Workers AI is enabled with `WORKERS_AI_ENABLED = "true"`, but automatic routing keeps it behind non-Cloudflare providers so it is a fallback source of compute.
- Every Workers AI call path must pass through `NEURON_BUDGET`, which caps usage at 9,500 Neurons/day, 500 below Cloudflare's 10,000 Neurons/day free allocation.
- The 2026-10-02 reviewed baseline reserves 250 Neurons once on top of existing DO usage for traffic preceding shared consumer bindings. Date-keyed offsets are applied once and persisted; later rollout days require their own verified baseline if calls can bypass the shared reservation.
- Text and embedding reservations use the current published per-model Neuron rates and a 20% buffer. Input is reserved at one token per UTF-8 byte of serialized request text; output is reserved to the requested `max_tokens` (512 default, 8,192 maximum), and Workers AI receives that same enforced value. Unknown models, multimodal chat, and unpriced image/audio paths fail closed before Workers AI inference.
- Vectorize query dimensions reserve atomically against a 45,000,000 dimension monthly ceiling, 5M below the Workers Paid 50M queried-dimension inclusion. The reviewed October 2026 application baseline is 35M; a read-only provider snapshot estimated 29,019,136 dimensions (28,764,928 corpus dimensions + 331 October queries × configured index dimensions = 254,208). That leaves about 5.98M above observed usage as a freshness/reconciliation margin, then 10M of application admission before the 45M guard stops queries. Wrangler metadata was read Oct 2; its `processedUpToDatetime` fields describe each index's last processed mutation, not a usage-count freshness timestamp, and all were before October. This is a bounded app-admission estimate, not Cloudflare's billable meter. The UI's 71.59k total-vector headline is unexplained against the CLI's 35,795 vectors, and its detail subtotal differs by 1,659 vectors; these discrepancies remain unresolved.
- The October baseline accounts for existing stored vectors in the queried-dimension calculation, but does not approve new vector storage/upserts. Existing stored dimensions are also billed separately: the estimated 28,764,928 corpus dimensions exceed the Workers Paid 10M stored-dimension inclusion by 18,764,928, with estimated marginal storage cost of about $0.0094/month. That existing storage exposure remains unresolved separately from query admission. Do not claim absolute $0 spend from this application guard.
- The DO initializes only a missing or valid prior-period state from the reviewed exact-month baseline, preserves higher same-month usage atomically, and fails closed for an unverified month or malformed history. No automatic zero rollover, public seed, or reset path exists. A later month remains blocked until its own baseline is verified and reviewed.
- These application reservations protect only calls routed through this gateway. They are not account-level billing caps, and cannot bound other Cloudflare consumers or direct API usage.
- Workers Logs/observability sampling is disabled in committed config because Workers Logs can create paid overage on Workers Paid plans.
- Worker CPU is capped at 10ms in committed config, matching the Workers Free per-invocation CPU limit.
- The unused Cloudflare Rate Limiting binding is not configured; request throttling uses `IpRateLimitDO`.

Run the local guard before deployment prep:

```bash
pnpm audit:cloudflare-costs
```

`pnpm check` also runs this audit before typecheck and unit tests.

Do not enable Workers Logs, higher CPU limits, paid-plan-only bindings, or a Workers AI neuron cap above 9,500/day in committed config unless the task explicitly approves paid Cloudflare usage and records the expected monthly ceiling.

Reference points checked on 2026-10-02 against [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/):

- Workers AI free allocation: 10,000 Neurons/day.
- Embedding prices used: BGE small 1,841, base 6,058, and large 18,582 Neurons per million tokens.
- Vectorize paid queried-dimension allowance: 50 million/month; gateway reservation ceiling: 45 million/month. Stored dimensions have a separate 10 million/month paid allowance; see [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/).
- Workers Free request/CPU posture: 100,000 requests/day and 10ms CPU/invocation.
- Workers Logs paid overage can apply on Workers Paid plans.
- D1, KV, and SQLite-backed Durable Objects have Free plan quotas that fail closed when exceeded on Free plans.
