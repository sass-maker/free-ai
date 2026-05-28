# Free AI Gateway

OpenAI-compatible API gateway that routes requests across free LLM providers with health-aware model selection, capability-based filtering, and aggregated analytics. Powered by [SaaS Maker](https://sassmaker.com).

## Deployment & External Services

| Concern | Service |
|---------|---------|
| Hosting | Cloudflare Workers (`free-ai-gateway`) — deployed via `wrangler deploy` |
| Database | Cloudflare D1 (`free-ai-gateway-db`) — anonymous aggregate analytics |
| State / Caching | Cloudflare Durable Objects (`HealthStateDO`, `IpRateLimitDO`, `NeuronBudgetDO`); Cloudflare KV (`HEALTH_KV`) |
| Marketing / docs site | Astro + Starlight (`site/`), built into `site/dist` and served by the Worker via the `ASSETS` binding — no separate deploy |
| AI | Cloudflare Workers AI (`AI` binding) plus upstream provider free tiers (Groq, Gemini, OpenRouter, Cerebras, SambaNova, NVIDIA, Voyage) |
| CI/CD | GitHub Actions (`.github/workflows/cloudflare-deploy.yml`) — auto-deploy on push to `main` |

## Architecture & Toolkit

This gateway is built to be hyper-scalable, stateless, and 100% free using the Cloudflare ecosystem:

- **Compute:** Cloudflare Workers (Hono + TypeScript + Zod)
- **Analytics:** Cloudflare D1 (Serverless SQLite) — aggregates strictly anonymous counters (no individual request logs are stored).
- **State Management:** Cloudflare Durable Objects track rate limiting and rolling model health (success rates, latencies).
- **Caching:** Cloudflare KV stores fast, ephemeral health snapshots to keep edge routing instant.

## Cloudflare Cost Posture

The committed Cloudflare config is free-first. Workers AI is enabled only as a fallback behind non-Cloudflare providers and is capped by `NEURON_BUDGET` at 9,500 neurons/day. Workers Logs sampling is off, CPU is capped to the Workers Free limit, and the unused Cloudflare Rate Limiting binding is not configured. Run `pnpm audit:cloudflare-costs` before deployment prep; `pnpm check` runs it automatically. See [docs/cloudflare-cost-guardrails.md](docs/cloudflare-cost-guardrails.md) for the current guardrails.

## Authentication & Project ID

Production gateway requests require a Bearer token:

```http
Authorization: Bearer <GATEWAY_API_KEY>
```

All completion, response, embedding, image, video, and audio requests also require a `project_id` so analytics and rate accounting stay isolated by app.

You can provide the project ID in one of two ways:
1. As a field in the JSON body: `"project_id": "my_project_123"`
2. As a header: `X-Gateway-Project-Id: my_project_123`

Public health and model listing endpoints do not require a token. Data-generating `/v1/*` endpoints fail closed with `401` when `GATEWAY_API_KEY` is missing or invalid.

Operators can keep the legacy `GATEWAY_API_KEY` secret and add more accepted keys through `GATEWAY_API_KEY_HASHES`, a comma- or newline-separated list of SHA-256 hex digests. Entries may be labeled as `label:sha256hex` for rotation notes.

## Chat Models

Use `model: "auto"` to let the gateway pick the best available model, or specify an exact model ID.

### Capability Legend

- **TC** = Tool/function calling
- **JM** = JSON mode (structured output)
- **V** = Vision (image input)
- **CTX** = Context window (tokens)
- **MOT** = Max output tokens

### Workers AI (free via Cloudflare)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `workers-ai-llama-3.3-70b` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | high | | | | 131k | 4k | 200 |
| `workers-ai-deepseek-r1-32b` | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | high | | | | 32k | 4k | 200 |
| `workers-ai-qwen-14b` | `@cf/qwen/qwen1.5-14b-chat-awq` | medium | | | | 8k | 2k | 300 |
| `workers-ai-llama-8b` | `@cf/meta/llama-3.1-8b-instruct` | medium | | | | 131k | 4k | 500 |
| `workers-ai-gemma-7b` | `@cf/google/gemma-7b-it-lora` | medium | | | | 8k | 2k | 500 |
| `workers-ai-mistral-7b` | `@cf/mistral/mistral-7b-instruct-v0.1` | low | | | | 8k | 2k | 500 |
| `workers-ai-llama-3b` | `@cf/meta/llama-3.2-3b-instruct` | low | | | | 131k | 4k | 800 |
| `workers-ai-llama-1b` | `@cf/meta/llama-3.2-1b-instruct` | low | | | | 131k | 4k | 1000 |
| `workers-ai-phi-2` | `@cf/microsoft/phi-2` | low | | | | 2k | 1k | 800 |

### Groq (free tier)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `groq-llama-70b` | `llama-3.3-70b-versatile` | high | Y | Y | | 131k | 32k | 300 |
| `groq-gpt-oss-120b` | `openai/gpt-oss-120b` | high | Y | Y | | 32k | 8k | 200 |
| `groq-kimi-k2` | `moonshotai/kimi-k2-instruct` | high | Y | Y | | 131k | 8k | 300 |
| `groq-qwen3-32b` | `qwen/qwen3-32b` | high | Y | Y | | 32k | 8k | 500 |
| `groq-gpt-oss-20b` | `openai/gpt-oss-20b` | medium | Y | Y | | 32k | 8k | 500 |
| `groq-llama4-maverick` | `meta-llama/llama-4-maverick-17b-128e-instruct` | medium | Y | Y | Y | 131k | 8k | 500 |
| `groq-llama4-scout` | `meta-llama/llama-4-scout-17b-16e-instruct` | medium | Y | Y | Y | 131k | 8k | 500 |
| `groq-llama-8b` | `llama-3.1-8b-instant` | low | Y | Y | | 131k | 8k | 1500 |

### Gemini (free tier)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `gemini-2.5-pro` | `gemini-2.5-pro` | high | Y | Y | Y | 1M | 64k | 50 |
| `gemini-2.5-flash` | `gemini-2.5-flash` | high | Y | Y | Y | 1M | 64k | 500 |
| `gemini-2.0-flash` | `gemini-2.0-flash` | medium | Y | Y | Y | 1M | 8k | 1000 |
| `gemini-2.0-flash-lite` | `gemini-2.0-flash-lite` | low | Y | Y | Y | 1M | 8k | 1500 |
| `gemini-2.5-flash-lite` | `gemini-2.5-flash-lite` | low | Y | Y | Y | 1M | 8k | 1500 |

### OpenRouter (needs OPENROUTER_API_KEY)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `openrouter-hermes-405b-free` | `nousresearch/hermes-3-llama-3.1-405b:free` | high | Y | Y | | 131k | 4k | 50 |
| `openrouter-llama-70b-free` | `meta-llama/llama-3.3-70b-instruct:free` | high | Y | Y | | 131k | 4k | 50 |
| `openrouter-gpt-oss-120b-free` | `openai/gpt-oss-120b:free` | high | Y | Y | | 32k | 8k | 50 |
| `openrouter-qwen3-next-80b-free` | `qwen/qwen3-next-80b-a3b-instruct:free` | high | Y | Y | | 32k | 8k | 50 |
| `openrouter-qwen3-coder-free` | `qwen/qwen3-coder:free` | high | Y | Y | | 131k | 8k | 50 |
| `openrouter-mistral-small-24b-free` | `mistralai/mistral-small-3.1-24b-instruct:free` | medium | Y | Y | Y | 32k | 8k | 100 |
| `openrouter-gemma3-27b-free` | `google/gemma-3-27b-it:free` | medium | | Y | Y | 131k | 8k | 100 |
| `openrouter-stepfun-flash-free` | `stepfun/step-3.5-flash:free` | medium | | Y | | 32k | 8k | 100 |
| `openrouter-gemma3-12b-free` | `google/gemma-3-12b-it:free` | medium | | Y | Y | 131k | 8k | 100 |
| `openrouter-nvidia-nemotron-12b-free` | `nvidia/nemotron-nano-12b-v2-vl:free` | medium | | Y | Y | 32k | 4k | 100 |

### Cerebras (needs CEREBRAS_API_KEY)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `cerebras-gpt-oss-120b` | `gpt-oss-120b` | high | Y | Y | | 32k | 8k | 300 |
| `cerebras-llama-8b` | `llama3.1-8b` | low | Y | Y | | 131k | 8k | 1000 |

### SambaNova (free tier, needs SAMBANOVA_API_KEY)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `sambanova-llama-70b` | `Meta-Llama-3.3-70B-Instruct` | high | Y | Y | | 131k | 8k | 500 |
| `sambanova-deepseek-v3` | `DeepSeek-V3-0324` | high | Y | Y | | 131k | 8k | 300 |
| `sambanova-qwen3-32b` | `Qwen3-32B` | high | Y | Y | | 32k | 8k | 500 |

### NVIDIA NIM (free tier, needs NVIDIA_API_KEY)

| Model ID | Actual Model | Tier | TC | JM | V | CTX | MOT | Daily Limit |
|----------|-------------|------|:--:|:--:|:-:|----:|----:|------------:|
| `nvidia-llama-70b` | `meta/llama-3.3-70b-instruct` | high | Y | Y | | 131k | 8k | 500 |
| `nvidia-deepseek-r1` | `deepseek-ai/deepseek-r1` | high | | Y | | 131k | 8k | 300 |
| `nvidia-qwen-32b` | `qwen/qwen3-32b` | high | Y | Y | | 32k | 8k | 500 |

## Agentic Use (Tool Calling & Structured Output)

The gateway automatically routes requests to capable models when you use agentic features:

- **Send `tools`** → gateway only picks models with tool calling support
- **Send `response_format: { type: "json_object" }`** → gateway only picks models with JSON mode
- If no capable model is available, the gateway returns a `503` rather than silently failing

This makes the gateway compatible with agent frameworks like LangChain, CrewAI, Vercel AI SDK, etc.

### Tool Calling Example

```bash
curl $GATEWAY_URL/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "project_id": "demo_project",
    "messages": [{"role": "user", "content": "What is the weather in SF?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": { "location": { "type": "string" } },
          "required": ["location"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

### JSON Mode Example

```bash
curl $GATEWAY_URL/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "project_id": "demo_project",
    "messages": [{"role": "user", "content": "List 3 colors as JSON"}],
    "response_format": { "type": "json_object" }
  }'
```

## Embedding Models (6 models, 3 providers)

Embeddings require an explicit model — `auto` is not supported.

| Model ID | Provider | Notes |
|----------|----------|-------|
| `gemini-embedding-001` | Gemini | Default, highest priority |
| `voyage-3.5-lite` | Voyage AI | Fallback #1 |
| `voyage-3-lite` | Voyage AI | Fallback #2 |
| `@cf/baai/bge-large-en-v1.5` | Workers AI | 768-dim, largest |
| `@cf/baai/bge-base-en-v1.5` | Workers AI | 768-dim, balanced |
| `@cf/baai/bge-small-en-v1.5` | Workers AI | 384-dim, fastest |

**Aliases** — these map to `gemini-embedding-001`:
- `text-embedding-3-small`
- `text-embedding-3-large`
- `text-embedding-004`

## Quick Health Check

Before making your first request, verify the gateway is live and see which providers are healthy right now — no auth required:

```bash
curl https://free-ai-gateway.sarthakagrawal927.workers.dev/v1/routing/status
```

A healthy response lists providers with their `latency`, `headroom`, and `cooldown` status. Any provider with `"degraded": false` is ready to route to. If all providers show `"degraded": true`, check back in a few minutes — the gateway auto-recovers as provider rate limits reset.

### What to expect on the free tier

This gateway aggregates each provider's free tier — it is **best-effort, not an SLA**. Plan for the following:

- **Per-IP rate limit**: ~10 requests burst, ~20 requests/minute sustained. Bursting harder will get you `429`s — back off and retry.
- **Per-model daily caps**: each model has a daily request budget (see the "Daily Limit" column in the model tables below). The gateway tracks remaining headroom and skips models that are out of quota.
- **Provider hiccups are normal**: upstream free tiers throttle, time out, or briefly disappear. The gateway transparently retries across providers; the only time you see a `503` is when *every* capable model is degraded — usually clears in a few minutes as windows reset.
- **No "exactly this model" guarantee** with `model: "auto"`: the gateway routes to the best healthy model that matches your required capabilities (tools, JSON, vision, context). Pin a specific `model` ID if you need determinism.
- **If you need higher throughput or SLAs**: bring your own paid provider keys and call them directly — the free tiers are intentionally capped to keep the gateway free for everyone.

## API Endpoints

Base URL: `https://free-ai-gateway.sarthakagrawal927.workers.dev`

### Chat Completions

```
POST /v1/chat/completions
```

```bash
curl $GATEWAY_URL/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "project_id": "demo_project",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

**Equivalent with the OpenAI SDK (TypeScript/JavaScript):**

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GATEWAY_API_KEY,
  baseURL: 'https://free-ai-gateway.sarthakagrawal927.workers.dev/v1',
});

const response = await client.chat.completions.create({
  model: 'auto',
  extra_body: { project_id: 'my_project' },
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(response.choices[0].message.content);
```

**Equivalent with the OpenAI SDK (Python):**

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["GATEWAY_API_KEY"],
    base_url="https://free-ai-gateway.sarthakagrawal927.workers.dev/v1",
)

response = client.chat.completions.create(
    model="auto",
    extra_body={"project_id": "my_project"},
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Model ID or `auto` (default) |
| `messages` | array | Yes* | OpenAI-format messages |
| `prompt` | string | Yes* | Shorthand when `messages` is omitted |
| `stream` | boolean | No | Enable SSE streaming (default false) |
| `temperature` | number | No | 0–2 |
| `max_tokens` | number | No | 1–8192 |
| `reasoning_effort` | string | No | `auto`, `low`, `medium`, `high` |
| `tools` | array | No | OpenAI-format tool definitions |
| `tool_choice` | string/object | No | `none`, `auto`, `required`, or `{type: "function", function: {name: "..."}}` |
| `response_format` | object | No | `{type: "text"}` or `{type: "json_object"}` |

*Either `messages` or `prompt` is required.

### Responses API

```
POST /v1/responses
```

OpenAI Responses API compatible. Non-streaming only. Internally proxies to `/v1/chat/completions`.

### Embeddings

```
POST /v1/embeddings
```

```bash
curl $GATEWAY_URL/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-embedding-001",
    "project_id": "demo_project",
    "input": ["text to embed"]
  }'
```

### Models

```
GET /v1/models
```

Lists all available models with health status and routing metadata.

### Routing Status

```
GET /v1/routing/status
```

Returns the current text-model fallback order with provider, latency, headroom,
cooldown, and degradation reasons. This is a read-only operator endpoint for
answering "which providers are usable right now, and what will the gateway try
next?" without spending provider quota.

### Health

```
GET /health
```

Returns model health snapshots.

### Analytics

```
GET /v1/analytics?project_id=<id>&days=<n>
```

Returns aggregate request volume and success rates broken down by provider,
model, project, and day. This read-only endpoint is public so the owner
dashboard at `/dashboard` can show all stats without a token. Token-spending
chat, embedding, image, video, and audio routes still require `GATEWAY_API_KEY`.

## Response Extensions

All responses include an `x_gateway` field:

```json
{
  "x_gateway": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "attempts": 1,
    "reasoning_effort": "auto",
    "request_id": "abc123"
  }
}
```

## SDK Usage

Works with the standard OpenAI SDK:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GATEWAY_API_KEY,
  baseURL: 'https://free-ai-gateway.sarthakagrawal927.workers.dev/v1',
});

const response = await client.chat.completions.create({
  model: 'auto',
  // You can pass it in the body via extra_body:
  extra_body: { project_id: 'my_project' },
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### With Tool Calling (TypeScript)

```typescript
const response = await client.chat.completions.create({
  model: 'auto',
  extra_body: { project_id: 'my_project' },
  messages: [{ role: 'user', content: 'What is the weather in SF?' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    },
  }],
  tool_choice: 'auto',
});
```

## Provider Routing

The gateway uses health-aware routing with capability filtering:
- Tracks success rate, latency, and daily usage per model
- Filters models by required capabilities (tool calling, JSON mode, vision)
- Respects `reasoning_effort` to prefer models matching the requested tier
- Automatically retries on failure with next-best model
- Force a specific provider with `X-Gateway-Force-Provider: groq` header
- Force a specific model with `X-Gateway-Force-Model: llama-3.3-70b-versatile` header

### What happens when a free provider fails?

A single failing provider does not fail your request. For each call the gateway:

1. Picks the best candidate model (based on success rate, latency, and remaining daily headroom).
2. If the upstream provider returns an error, times out, or hits its free-tier rate limit, the gateway **marks that model as cooled down** and immediately retries with the next-best candidate from a different provider.
3. The retry loop continues until a model responds successfully — or, if every capable model is degraded, the gateway returns a `503` instead of silently dropping the request.
4. The response includes an `x_gateway.attempts` counter so you can see how many providers were tried before one succeeded.

You don't need to manage per-provider keys, retries, or backoff in your app — the gateway handles all of that.

**Where to check status:** the public, no-auth endpoint `GET /v1/routing/status` returns the live fallback order with each provider's `latency`, `headroom`, `cooldown`, and `degraded` flag. If everything looks degraded, providers usually recover within a few minutes as their rate-limit windows reset.

```bash
curl https://free-ai-gateway.sarthakagrawal927.workers.dev/v1/routing/status
```

## Rate Limits

The gateway enforces two layers of limits, both designed to keep the free tier usable for everyone:

- **Per-IP gateway limit** — token bucket: **10 requests burst, ~20 requests/minute sustained**. Excess requests return `429 Too Many Requests`; wait a few seconds and retry.
- **Per-model daily caps** — each upstream provider has its own free-tier quota (see the "Daily Limit" column in the model tables above). When a model is out of headroom or returns a rate-limit error, the gateway cools it down and falls back to the next-best capable model automatically. You only see a `503` when every capable model is degraded.

**Rule of thumb:** treat this as a development / hobby / prototyping gateway. If you need predictable production throughput, pin a specific model and bring your own provider keys.

## Development

```bash
pnpm install
cp .env.example .env  # fill provider keys
pnpm dev:local
```

## Deploy

```bash
pnpm wrangler deploy
```

<!-- ACTIVE-AI-TASK-LOG:START -->
## Active AI Task Log

This section is maintained by the SaaS Maker Active-AI product/design loop so future agents do not reopen duplicate UI tasks.

- Business lane: P1 Explore
- Rule: do not create another broad "improve the UI" task unless the acceptance criteria differ materially from the tasks listed here.
- Source of truth for task status: SaaS Maker task board. README entries are durable context only.

| Task | Status | Priority | Last known note |
| --- | --- | --- | --- |
| `2e1f9b66` free-ai: add public landing + obvious 'Get API key' CTA + quickstart | done | medium | 2026-05-25 17:02:56 |
| `fa8b0311` free-ai: add provider status proof to landing quickstart | done | medium | 2026-05-26 — added health check block + routing status curl to README and getting-started docs |
| `95674068` free-ai: add fallback provider explanation | done | medium | 2026-05-26 — added "What happens when a free provider fails?" explainer to README Provider Routing section, covering cooldown/retry behavior, `x_gateway.attempts`, and the `/v1/routing/status` check |
| `3d7d9a34` free-ai: add rate-limit expectation copy | done | medium | 2026-05-26 — added "What to expect on the free tier" callout near Quick Health Check, expanded Rate Limits section with the two-layer model, and added a free-tier note under the getting-started "Check Provider Status" block and the landing-page quickstart card |
| `ac9adb19` free-ai: add curl-to-SDK quickstart bridge | done | medium | 2026-05-26 — added TypeScript + Python SDK snippets after the curl Chat Completions example in README; added a "terminal / openai sdk" tab switcher to the landing-page code window in index.astro (no new dependencies) |
| `b26c3e9d` free-ai: add saved-cost and reliability proof strip | done | medium | 2026-05-26 — added `.proof-strip` section to index.astro between hero and features: shows live free-requests count (fetched from public `/v1/stats/providers`), 8+ provider fallback chain, and estimated cost saved vs. GPT-4o mini pricing; no backend changes |
<!-- ACTIVE-AI-TASK-LOG:END -->
