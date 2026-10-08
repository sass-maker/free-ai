# Cloudflare Cost Guardrails

This gateway should run without surprise Cloudflare charges. The committed config is intentionally free-first:

- Workers AI is enabled with `WORKERS_AI_ENABLED = "true"`, but automatic routing keeps it behind non-Cloudflare providers so it is a fallback source of compute.
- Every Workers AI call path must pass through `NEURON_BUDGET`, which caps usage at 9,500 Neurons/day, 500 below Cloudflare's 10,000 Neurons/day free allocation.
- The 2026-10-02 reviewed baseline reserves 250 Neurons once on top of existing DO usage for traffic preceding shared consumer bindings. Date-keyed offsets are applied once and persisted; later rollout days require their own verified baseline if calls can bypass the shared reservation.
- Text and embedding reservations use the current published per-model Neuron rates and a 20% buffer. Input is reserved at one token per UTF-8 byte of serialized request text; output is reserved to the requested `max_tokens` (512 default, 8,192 maximum), and Workers AI receives that same enforced value. Unknown models, multimodal chat, and unpriced image/audio paths fail closed before Workers AI inference.
- Vectorize query dimensions reserve atomically against a 45,000,000 dimension monthly ceiling, 5M below the Workers Paid 50M queried-dimension inclusion. The reviewed October 2026 application baseline is 35M; a read-only provider snapshot estimated 29,019,136 dimensions (28,764,928 corpus dimensions + 331 October queries × configured index dimensions = 254,208). That leaves about 5.98M above observed usage as a freshness/reconciliation margin, then 10M of application admission before the 45M guard stops queries. Wrangler metadata was read Oct 2; its `processedUpToDatetime` fields describe each index's last processed mutation, not a usage-count freshness timestamp, and all were before October. This is a bounded app-admission estimate, not Cloudflare's billable meter. The UI's 71.59k total-vector headline is unexplained against the CLI's 35,795 vectors, and its detail subtotal differs by 1,659 vectors; these discrepancies remain unresolved.
- Starboard's owner-approved Vectorize ceiling is $1/month. The existing private budget binding now admits storage growth atomically: each write reserves its full raw dimension count in both the query ledger and a separate stored-dimension ledger before inference. The stored ledger starts at 30M dimensions for October (rounded up from the Oct 8 read-only account inventory of 28,764,928 dimensions) and caps gross occupancy at 200M. Every retry/upsert counts as new growth; failures and ambiguous outcomes never refund capacity. At the published rates, 45M queried dimensions cost at most $0.45 and 200M stored dimensions cost at most $0.10 for a full month, even without plan inclusions: $0.55 combined for traffic admitted through these guards. This is an application bound, not a Cloudflare account-wide hard cap; other writers remain outside its control. Unverified months and malformed ledgers fail closed.
- The Oct 8 authenticated billing view showed 4M queried dimensions and 5.75M stored dimension-months, both with $0 billable usage; its selected period was October 1–31, with usage observed through October 8. These billable, prorated metrics differ from instantaneous index occupancy. Budget alerts are informational and do not stop usage. See [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) and [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).
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
