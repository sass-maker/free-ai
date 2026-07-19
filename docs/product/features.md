# Product Features (shipped)

What the gateway does today. For the user-facing API reference see
[`../../site/src/content/docs/`](../../site/src/content/docs/) (rendered by
Starlight). For the public product overview see [`../../README.md`](../../README.md).

## Gateway core — authenticated `/v1/*` routes

- `POST /v1/chat/completions` — OpenAI-compatible chat; `model: "auto"` or
  explicit; streaming SSE; tools, JSON mode, vision capability filtering.
- `POST /v1/responses` — OpenAI Responses API compatible (non-streaming; proxies
  to chat completions).
- `POST /v1/embeddings` — explicit model required (no auto); 6 models across
  Gemini/Voyage/Workers AI; aliases for OpenAI embedding names.
- `POST /v1/images/generations` — image generation routing.
- `POST /v1/videos/generations` — async video submit; `GET /v1/videos/generations/{id}` poll.
- `POST /v1/audio/speech` — TTS standalone.
- `POST /v1/audio/transcriptions` — STT (Groq upstream).
- `POST /v1/audio/speech-to-speech` — STT → LLM → TTS pipeline.
- `POST /v1/debug/replay` — operator debug replay (skips health/analytics writes).
- All responses include `x_gateway` metadata: provider, model, attempts,
  reasoning_effort, request_id.

## Public read-only routes (no auth)

- `GET /health` — model health snapshots (browser → HTML, API → JSON).
- `GET /v1/models` — searchable model catalog (browser HTML / API JSON).
- `GET /v1/routing/status` — live fallback order with latency, headroom, cooldown,
  degraded flags.
- `GET /v1/routing/config` — routing configuration.
- `GET /v1/routing/ledger` — anonymous routing experiment ledger
  (`routing_ledger_rollup` D1).
- `GET /v1/provider-quotas` — provider quota poller status.
- `GET /v1/analytics` — aggregate volume/success by provider, model, project, day.
- `GET /v1/stats/providers` — provider stats for landing proof strip.
- `GET /v1/budget` — Neuron budget remaining (Workers AI).
- `GET /v1/benchmark/optimizer` — benchmark optimizer data.
- `POST /v1/benchmark/experiments` — record routing experiments.

## Operator UI

`/dashboard`, `/live`, `/v1/dashboard`, `/benchmark`, `/v1/benchmark`, `/models`,
`/status`.

## Products

- **Gateway Worker:** `https://ai-gateway.sassmaker.com` — worker
  `free-ai-gateway`; D1 `free-ai-gateway-db`.
- **Docs/landing (bundled):** Astro/Starlight site in `site/dist`, served via
  Worker `ASSETS` binding (`run_worker_first=true`) — no separate deploy.
- **Examples:** `examples/node-openai-sdk/`, `examples/python-openai-sdk/`.
- **Playground:** Vite build via `pnpm build:playground` (behind
  `PLAYGROUND_ENABLED=false` by default).

## Provider catalog

80+ chat models across 11 providers, plus 6 embedding models across 3 providers.

Chat providers:

- **Workers AI** (CF AI binding, no extra key) — fallback rank, neuron-budgeted.
- **Groq** — `GROQ_API_KEY`.
- **Gemini** — `GEMINI_API_KEY`.
- **OpenRouter** — `OPENROUTER_API_KEY` (free `:free` model variants).
- **Cerebras** — `CEREBRAS_API_KEY`.
- **SambaNova** — `SAMBANOVA_API_KEY`.
- **NVIDIA NIM** — `NVIDIA_API_KEY`.
- **GitHub Models** — `GITHUB_TOKEN`.
- **Pollinations** — no key required.
- **Cohere** — `COHERE_API_KEY`.
- **Mistral** — `MISTRAL_API_KEY`.

Embedding providers: Gemini, Voyage AI (`VOYAGE_API_KEY`), Workers AI.

The authoritative model registry is `src/config.ts`. The model tables in
[`README.md`](../../README.md) are a snapshot for users; `src/config.ts` is the
source of truth. The weekly `check-models.yml` workflow auto-detects drift and
opens a PR.

## Durable Objects & storage

- `HealthStateDO` (v1 migration) — per-model health tracking.
- `IpRateLimitDO` (v1) — per-IP token bucket (10 burst / ~20 rpm).
- `NeuronBudgetDO` (v2) — daily Workers AI neuron cap (9,500/day).
- `HEALTH_KV` — ephemeral health snapshots (debounced, 5-min TTL).
- D1 `GATEWAY_DB` — anonymous analytics aggregates + `routing_ledger_rollup`.

## Tests

- Vitest with `@cloudflare/vitest-pool-workers`.
- v8 coverage thresholds gate core modules at 80/80/80/70. See
  [`development/testing.md`](../development/testing.md).
- Playwright e2e (local mock + live smoke).
