# Cloudflare Cost Guardrails

This gateway should run without surprise Cloudflare charges. The committed config is intentionally free-first:

- Workers AI is bound but disabled by default with `WORKERS_AI_ENABLED = "false"`.
- Every Workers AI call path must pass through `NEURON_BUDGET`, which caps usage at 9,500 Neurons/day, 500 below Cloudflare's 10,000 Neurons/day free allocation.
- Workers Logs/observability sampling is disabled in committed config because Workers Logs can create paid overage on Workers Paid plans.
- Worker CPU is capped at 10ms in committed config, matching the Workers Free per-invocation CPU limit.
- The unused Cloudflare Rate Limiting binding is not configured; request throttling uses `IpRateLimitDO`.

Run the local guard before deployment prep:

```bash
pnpm audit:cloudflare-costs
```

`pnpm check` also runs this audit before typecheck and unit tests.

Do not enable Workers AI, Workers Logs, higher CPU limits, or paid-plan-only bindings in committed config unless the task explicitly approves paid Cloudflare usage and records the expected monthly ceiling.

Reference points checked on 2026-05-09:

- Workers AI free allocation: 10,000 Neurons/day.
- Workers Free request/CPU posture: 100,000 requests/day and 10ms CPU/invocation.
- Workers Logs paid overage can apply on Workers Paid plans.
- D1, KV, and SQLite-backed Durable Objects have Free plan quotas that fail closed when exceeded on Free plans.
