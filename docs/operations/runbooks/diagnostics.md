# Diagnostic Runbook

Operational procedures for common gateway issues. For deploy steps see
[`deploy.md`](../deploy.md).

## All providers degraded (503 on every request)

1. Check live routing status:
   ```bash
   curl -s https://ai-gateway.sassmaker.com/v1/routing/status | jq
   ```
   If every entry has `"degraded": true`, providers are likely rate-limited —
   usually clears in a few minutes as windows reset.
2. Check `/v1/provider-quotas` for OpenRouter credit exhaustion:
   ```bash
   curl -s https://ai-gateway.sassmaker.com/v1/provider-quotas | jq
   ```
3. Check `/v1/budget` for Workers AI neuron exhaustion:
   ```bash
   curl -s https://ai-gateway.sassmaker.com/v1/budget | jq
   ```
   If `remaining` is near 0, Workers AI is capped until UTC midnight. Non-Workers-AI
   providers should still route.
4. If only Workers AI is degraded, that is expected — it is intentionally
   last-rank. The issue is upstream of Workers AI.
5. Force a specific provider to test connectivity:
   ```bash
   curl -s $GW/v1/chat/completions \
     -H "Authorization: Bearer $KEY" -H "X-Gateway-Force-Provider: groq" \
     -d '{"model":"auto","project_id":"diag","messages":[{"role":"user","content":"ping"}]}'
   ```

## A specific model always fails

1. Use the replay lab to call the provider directly **without** polluting health
   state:
   ```bash
   curl -s $GW/v1/debug/replay \
     -H "Authorization: Bearer $KEY" \
     -d '{"provider":"groq","model":"llama-3.3-70b-versatile","messages":[...]}'
   ```
   `/v1/debug/replay` intentionally skips `healthRecord()` and `recordAnalytics()`.
2. If the provider returns 400 for a capability (e.g. vision), check
   `GITHUB_MODELS_IMAGE_INCOMPATIBLE` and the capability flags in `src/config.ts` —
   the model may be miscataloged.
3. If the provider key is exhausted, rotate it via `wrangler secret put`.

## Pinned Gemini fails despite a multi-key pool

Check the upstream status before interpreting gateway HTTP 429 as quota
exhaustion: the retriable class also includes upstream 5xx and timeouts. Google
documents quotas [per project, not per key](https://ai.google.dev/gemini-api/docs/rate-limits).
Separate projects can have different model access and allowance; key count alone
does not establish either. Do not expose key values during diagnosis.

For pinned chat requests the recovery path uses the existing two-attempt budget to try a distinct
Gemini key after an access or retriable failure. It preserves the model, refusal
handling, cancellation and SDK retry limits; it does not walk all keys or change
embedding routing. A pending key retry stays in health history without cooling
the entire model immediately. Terminal retriable failure still triggers cooldown.

After release, inspect the prompt-free `gateway.upstream_failed` log entries:
`upstream_status`, `key_slot`, `key_pool_size`, `attempt` and
`key_retry_pending`. Slots refer to positions in the configured pool, not key
values. `gateway.upstream_accepted` records successful slots too, so absence of
failure logs cannot be mistaken for tested access. For streams it confirms the
handshake, not completion of the entire stream. Error responses also retain `upstream_status` and `attempts` so a provider
503 cannot be mistaken for an observed Google quota error. Access-denied slots
need an account/project investigation; 503 by itself does not identify a bad key.

## Analytics show a spike in failures

1. `GET /v1/analytics?days=7` — look for the provider/model/day with the failure
   spike.
2. Cross-reference with `/v1/routing/status` cooldown state.
3. D1 `project_analytics` stores request counts, not token/neuron consumption.
   Historical Workers AI cost can only be bounded from request volume +
   `NeuronBudgetDO`, not reconstructed exactly. See
   [`knowledge/learnings/lessons.md`](../../knowledge/learnings/lessons.md).

## Debug replay distorts routing state

The normal chat path writes health + analytics on every attempt. Use `/v1/debug/replay`
for provider debugging — it skips both. See
[`knowledge/learnings/lessons.md`](../../knowledge/learnings/lessons.md).

## Safety refusal misclassified as a failure

Some providers return HTTP 200 with `finish_reason: content_filter` or refusal
text. `isSafetyRefusal()` checks response content, not just HTTP status. These are
not retryable — retrying just burns another attempt. If a safety refusal is being
retried, check `classifyError()` keyword matching in `src/router/classify-error.ts`.

## Workers AI neuron budget hit unexpectedly early

1. Check `/v1/budget` — `used` vs `cap` (9,500).
2. Token→Neuron estimates carry a 20% buffer (`NEURON_BUFFER = 1.2`). If the
   estimator is over-conservative, the gateway effectively gets fewer than 9,500
   usable Neurons. Cost accuracy improves with per-model tuning.
3. UTC midnight reset means heavy morning traffic (IST 05:30 UTC) hits a fresh cap.
4. The `/reset` endpoint on `NeuronBudgetDO` is protected by
   `x-gateway-internal: 1` header (unreachable from the public internet) for
   debugging without a DO namespace wipe.

## tsconfig / typecheck suddenly broken

The tsconfig was previously broken (no `include`, no workers types,
`noPropertyAccessFromIndexSignature` conflict). If typecheck fails after a
dependency change, verify:
- `@cloudflare/workers-types` is listed under `types` in `tsconfig.json`.
- `e2e-live/` is excluded from the main tsconfig (it needs `@types/node` which
  conflicts with workers-types globals).
