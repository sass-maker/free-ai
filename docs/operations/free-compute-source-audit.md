# Free Compute Source Audit

Checked on 2026-05-28; provider resync posture refreshed 2026-08-07.

## Current Coverage

The gateway has adapters for these text providers:

- Workers AI
- Groq
- Gemini
- OpenRouter
- Cerebras
- SambaNova
- NVIDIA
- GitHub Models
- Pollinations
- Cohere
- Mistral
- Z.ai / Zhipu GLM (added 2026-07)
- ModelScope (staged, disabled)
- SiliconFlow (adapter staged; no routing candidate)

ModelScope and SiliconFlow are integration candidates, not active routing
capacity. The ModelScope seed remains `enabled: false`; SiliconFlow has no
model candidate because the previously considered `Qwen/Qwen3-8B` is currently
pay-as-you-go. Adding either key cannot make these providers selectable.
Activation requires successful catalog evidence, a bounded authenticated
replay, capability/limit review, and a separate code change.

The gateway also has modality-specific providers for embeddings, images,
video, TTS, and STT. The provider directory is structurally consistent with
the TypeScript unions in `src/types.ts` and the caller maps in
`src/providers/index.ts`: every declared text provider has an adapter file, and
each modality registry filters providers through an availability check before
routing.

## Registry Resync — 2026-08-07

The OpenRouter catalog can be read without a credential, so
`scripts/check-model-ids.mjs` checks it even when `OPENROUTER_API_KEY` is absent.
The checker manages official catalogs for Groq, OpenRouter, Cerebras, Gemini,
SambaNova, NVIDIA, GitHub Models, Cohere, Mistral, Z.ai, ModelScope, and
SiliconFlow. Every catalog returns a structured `ok`, `missing_key`, or `error`
state. Missing credentials or malformed/upstream failures make coverage
incomplete, but never count configured models as stale.

The 2026-08-07 public-catalog resync produced these reviewed changes:

- Removed eight OpenRouter models no longer present upstream: Hermes 3 405B,
  Llama 3.3 70B, Qwen3 Next 80B, Qwen3 Coder, Llama 3.2 3B, Dolphin Mistral
  Venice, Laguna M 1, and Tencent HY 3 free variants.
- Staged `inclusionai/ling-3.0-tiny:free` and
  `poolside/laguna-s-2.1:free` as disabled candidates. OpenRouter currently
  lists both at zero prompt/completion price with text output, tool calling,
  optional reasoning, 262K context, and up to 32K output.
- New catalog discoveries are now generated with `enabled: false`. Listing by a
  provider proves discoverability, not runtime compatibility; an authenticated
  provider smoke is required before default routing activation.

The user-supplied `no-cost-ai` repository remains useful as a discovery index,
not as provider evidence. Its web interfaces and third-party aggregators are not
added without an official API contract, sustainable free allowance, privacy
review, and a kill switch. The user-supplied Ling collection became actionable
only because the existing OpenRouter provider independently listed Ling 3.0
Tiny in its API catalog.

## Historical Usage

D1 `project_analytics` currently records request counts, not exact token or neuron consumption. Historical Workers AI cost can therefore be bounded only from request volume and the `NeuronBudgetDO` estimator, not reconstructed exactly.

The 30-day production window reviewed on 2026-08-07 contained 8,856 requests,
6,948 successes, and 1,908 failures. The incident was concentrated rather than
capacity-wide:

| Provider/path | Requests | Successful | Failed | Decision |
| --- | ---: | ---: | ---: | --- |
| Mistral | 5,223 | 5,219 | 4 | Keep serving while healthy |
| NVIDIA Maverick | 1,701 | 26 | 1,675 | Manual-only pending recovery smoke |
| Cerebras | 636 | 635 | 1 | Keep serving while healthy |
| Workers AI | 267 | 267 | 0 | Keep fallback-only and neuron-capped |
| GitHub Models | 73 | 0 | 73 | Manual-only pending recovery smoke |
| Z.ai | 31 | 0 | 31 | Manual-only pending recovery smoke |

`model=auto` excludes the three failing paths above. They remain enabled for
explicit `/v1/debug/replay` diagnostics, and `/v1/models` exposes their
`automatic_routing: false` state. A path returns to automatic routing only
after bounded repeated smoke evidence and a reviewed policy change.

Mistral's share is monitored instead of forcibly redistributed to degraded
providers. The daily health report warns when one provider supplies more than
85% of at least 100 attributed successful requests; concentration alone does
not make the health check fail.

The following table is the earlier cumulative snapshot retained for historical
comparison:

Observed provider totals in production D1:

| Provider | Requests | Successful | Failed |
| --- | ---: | ---: | ---: |
| mistral | 1,151 | 1,151 | 0 |
| groq | 650 | 648 | 2 |
| nvidia | 521 | 520 | 1 |
| openrouter | 463 | 463 | 0 |
| workers_ai | 275 | 275 | 0 |
| github_models | 95 | 95 | 0 |
| pollinations | 29 | 29 | 0 |
| cerebras | 20 | 20 | 0 |
| gemini | 18 | 17 | 1 |
| cohere | 12 | 12 | 0 |
| together | 4 | 3 | 1 |

Workers AI historical request count is low and concentrated: 243 of 275 recorded Workers AI requests happened on 2026-05-01. It has 0 recorded failures in `project_analytics`.

## Cloudflare Cost Guard

Cloudflare documents Workers AI as free for 10,000 neurons/day, then billed on Workers Paid at $0.011 per 1,000 neurons above that free allocation. Neurons are GPU-compute units, not requests, so 10,000 neurons must not be treated as 10,000 gateway calls.

The current code keeps Workers AI on but guarded:

- Automatic text routing now ranks every non-Workers-AI provider ahead of Workers AI.
- Image, STT, and TTS priority sorting also places Workers AI last when the request is `model=auto` and no provider is forced.
- Explicit forced Workers AI usage still works.
- Every Workers AI provider path must debit `NEURON_BUDGET` before calling Workers AI.
- `DAILY_NEURON_CAP` remains 9,500/day, leaving a 500-neuron buffer below the documented free allocation.
- `pnpm audit:cloudflare-costs` now fails if the AI binding lacks `NEURON_BUDGET` or if the committed neuron cap exceeds 9,500/day.

## Addable Sources

### Skip for production routing: Hugging Face router

Hugging Face Inference Providers supports an OpenAI-compatible chat completion endpoint at `https://router.huggingface.co/v1` and exposes many providers through one token, including Cerebras, Cohere, DeepInfra, Fireworks, Groq, HF Inference, Novita, Public AI, Replicate, SambaNova, Together, and Z.ai.

Do not suggest Hugging Face again as a meaningful production free-compute source unless its free allowance changes materially. The free monthly credit is too small for gateway routing, so it is better treated as a manual test/probe provider than as part of the automatic fallback pool.

If it is ever added anyway, gate it behind `HF_TOKEN`, keep it out of `model=auto`, and require an explicit tiny daily cap plus account-credit visibility.

### Already useful: OpenRouter free variants

OpenRouter remains worth keeping because it exposes many `:free` model variants through one adapter. Its docs state that free variants have request-per-minute and request-per-day caps, and that `/api/v1/key` can report remaining credit/rate-limit state.

Recommended follow-up:

- Add an optional OpenRouter key-status poller to surface remaining daily free-model quota in `/v1/stats/providers`.
- Keep OpenRouter models lower than direct providers when a direct provider has better limits or health.

### Already useful: GitHub Models

GitHub Models includes rate-limited free usage for GitHub accounts, but paid usage can be enabled. This is a good fallback source, but it should stay behind hard per-provider limits unless the account budget is confirmed.

### Already useful: Groq and Cerebras

Groq and Cerebras publish free-tier or free-trial rate limits and should stay near the front of routing while healthy. They also return useful rate-limit headers, so the gateway can eventually learn headroom from headers instead of static request/day estimates.

## Staged provider opportunities (2026-08)

- **ModelScope** — the official inference API is OpenAI-compatible and advertises
  a daily free invocation allowance for selected models. `Qwen/Qwen3-32B` is
  staged disabled behind `MODELSCOPE_API_KEY`.
- **SiliconFlow** — the official API is OpenAI-compatible and documents a
  free-model rate-limit class, but its current `Qwen/Qwen3-8B` page lists
  pay-as-you-go pricing. The adapter remains staged without a model candidate
  until an official zero-price model is identified and smoke-tested.

These integrations add no default traffic. ModelScope's conservative daily
limit remains a placeholder until authenticated smoke and account-level quota
evidence are reviewed.

## Newly wired-in providers (2026-07)

One OpenAI-compatible provider was integrated as a first-class adapter in 2026-07 and is documented in [`docs/product/free-ai-credits-guide.md`](../product/free-ai-credits-guide.md):

- **Z.ai / Zhipu GLM** — free GLM-4.7-Flash + free vision via GLM-4.6V-Flash. Genuinely free forever (not credits). Adapter: `src/providers/zai.ts`.

The integration added one `src/providers/zai.ts` adapter, a `TextProvider` union entry, a `hasProviderKey` branch, a `PROVIDER_KEY_REQUIRED` flag, three model entries in `DEFAULT_MODELS`, and per-model `DEFAULT_LIMITS`. It ranks below the healthiest direct free-tier providers (Groq, Cerebras, Gemini) but above Workers AI fallback.

## Evaluated and rejected for low ROI (2026-07)

Five OpenAI-compatible providers remain deliberately **not** wired in, because
each adds an env var + adapter + routing entries in exchange for little or no
recurring free capacity we do not already have. Full rationale is in
[`docs/product/free-ai-credits-guide.md#not-integrated-evaluated-and-rejected-for-low-roi`](../product/free-ai-credits-guide.md#not-integrated-evaluated-and-rejected-for-low-roi):

- **DeepSeek** — the "free" offer is a one-time 5M-token grant (30 days, then paid). Not a recurring free tier; after the grant it's just another paid provider. We already have free frontier-class routing via Groq/Cerebras/Gemini/Z.ai.
- **Alibaba DashScope** — 1M tokens/model, 90 days; Qwen3 already reachable via Groq/Cerebras/OpenRouter.
- **01.AI (Yi)** — vague small signup tokens; not frontier.
- **OVH AI Endpoints** — same Llama 3.1 we already reach four other ways; only novel value is EU residency.
- **Reka** — unclear free tier size; multimodal angle already covered by Gemini for free.

Revisit only if the stated blocker changes.

## Sources Not Recommended As Default Yet

- Credit-only providers without a hard free cap should not be added to automatic routing unless we also store account budget/remaining-credit telemetry.
- Aggregators that advertise unlimited free inference but do not publish clear billing or sustainability terms should not be added to production routing without manual testing and a kill switch.
- Paid image/video models should remain out of automatic free routing unless the provider exposes a verified free tier for the specific model.

## Directory Findings

The current provider directory is written correctly for the providers already declared in `src/types.ts`; there are no missing adapter files for declared text providers. The notable gaps are product-level, not directory correctness:

- D1 analytics does not store exact token/neuron usage, so historical Cloudflare neuron cost cannot be reconstructed exactly.
- The catalog now separates `reasoning` as a routing strength tier from `nativeReasoning`, which marks models with actual reasoning/thinking behavior. This avoids treating every high-quality model as if it has native thinking controls.
- Some model limits are still marked `AUTO-ADDED -- tune`, so health and daily limits should be verified against provider dashboards over time.
- TTS only has a Workers AI registry entry today even though the type union allows `groq`; adding a non-Workers TTS provider would reduce Workers AI dependence for speech.

## Quota Polling

Graceful degradation is still the primary safety mechanism. Quota polling is advisory and should only suppress a provider when an official endpoint clearly reports exhaustion.

Current polling:

- OpenRouter `/api/v1/key` is cached in KV for five minutes.
- If OpenRouter reports `limit_remaining <= 0`, OpenRouter candidates are skipped before routing.
- If polling fails or the endpoint does not expose the free-model daily request count, routing falls back to existing health/degradation behavior.

This keeps routing latency and provider health cleaner without making an external quota endpoint a hard dependency.

## References

- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Hugging Face Inference Providers pricing: https://huggingface.co/docs/inference-providers/en/pricing
- Hugging Face OpenAI-compatible chat completion: https://huggingface.co/docs/inference-providers/tasks/chat-completion
- OpenRouter limits: https://openrouter.ai/docs/api/reference/limits
- GitHub Models billing: https://docs.github.com/en/billing/concepts/product-billing/github-models
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Cerebras rate limits: https://inference-docs.cerebras.ai/support/rate-limits
- ModelScope inference API: https://www.modelscope.cn/learn/434591
- SiliconFlow quickstart: https://docs.siliconflow.com/en/userguide/quickstart
- SiliconFlow rate limits: https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation
