# Modal embedding experiment

Tracking: [Free AI #100](https://github.com/sass-maker/free-ai/issues/100).
Backend deployment, revision pins, CPU measurements and source digest:
[knowledge-base #64](https://github.com/sass-maker/knowledge-base/issues/64).
Public request examples and model limits live in the
[embedding API reference](../../site/src/content/docs/embeddings.mdx).

## Access and deployment

The adapter calls fixed HTTPS URLs for the deployed `embedding-model-trial`
Modal app. Modal proxy authentication stays enabled. The gateway's usual key
and project attribution remain required; no client needs a Modal credential.
Two Worker secrets, `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET`, configure the
upstream header pair described in
[Modal proxy authentication](https://modal.com/docs/guide/webhook-proxy-auth).
Never put them in Git, logs, examples or public diagnostics.

Provision provider credentials only with operator authorization. Use the
existing [manual deployment workflow](deploy.md) after qualification. No new
dependencies, production configuration edits, database migrations or Durable
Object bindings are needed.

Catalog availability is credential-based, not an inference health probe.
These models have `automatic_routing: false`; disabled or failed Modal
models must not substitute other embedding spaces. Keep stored corpus vectors
and queries on the same exact model, dimensions and task convention.

## Cost assumptions

The deployed CPU classes have minimum containers zero, maximum one each, and a
30-second scale-down window. Gemma requests one physical core and 2 GiB memory,
limited to one core and 4 GiB. BGE requests 0.25 core and 0.75 GiB, limited to
0.5 core and 1.5 GiB. Images load only their pinned text models.

[Modal pricing](https://modal.com/pricing), checked October 7, 2026, lists
$0.0000131 per physical core-second and $0.00000222 per GiB-second.
Gemma's requested resources cost about $0.0631 per awake hour; its configured
limits cost $0.0791/hour. BGE's corresponding rates are $0.0178 and $0.0356.
Memory billing can exceed the requested baseline, so use the limit estimate
for planning. Startup, idle scale-down time and builds also consume credits.

The adapter reserves a token in the existing rate-limit Durable Object before
each upstream call, using one global name for both models and all projects.
It never refunds failed calls or retries them automatically. The bucket holds
five requests and refills at 60 requests per 24 hours. The existing object's
24-hour cleanup alarm can reset a bucket; therefore this is neither an exact
daily cap nor a monthly spend ledger.

For a conservative planning scenario of roughly 65 requests/day for 31 days,
all on Gemma, with 330 awake seconds per request (180 startup + 120 execution +
30 scale-down), compute is about $14.62 before credits at the configured limits.
Typical short requests should cost less. This scenario is not a billing bound:
platform startup/restarts, build time, queued traffic, direct authenticated
backend calls and other Modal applications are outside gateway admission.
The $30 Starter credit is shared across the account, not allocated to this app.
Do not describe this experiment as guaranteed free or unlimited.

## Qualification

Focused tests exercise the real gateway route and adapter with synthetic HTTP:
model pinning, disabled catalog entries, batch/dimension/task validation,
gateway auth, global fail-closed admission, sanitized upstream errors, malformed
vectors and cancellation. The backend separately validates token lengths,
finite normalized vectors and real inference with pinned weights.

Release requires the exact source SHA and successful manual workflow, followed
by authenticated gateway calls to both models. Check response model,
`x_gateway.provider`, vector counts/dimensions/unit norm, query/document tasks,
and anonymous denial. Record only sanitized summaries, never request
credentials. Catalog smoke alone does not qualify inference.

The backend cold SDK measurements were 35.2 seconds for Gemma and 26.6 seconds
for BGE; warm SDK medians were 571 and 505 ms. Backend-only inference was faster
for BGE. These measurements are small samples, not a throughput promise or
comparative retrieval benchmark.
