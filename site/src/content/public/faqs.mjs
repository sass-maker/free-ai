export const faqs = [
  {
    q: "What's a free OpenAI-compatible API gateway?",
    a: "It's a proxy that exposes the same request/response shape as the OpenAI API (/v1/chat/completions, /v1/embeddings, /v1/models) but routes each request to free-tier LLM providers instead of OpenAI's paid endpoints. You point your existing OpenAI SDK at the gateway by setting baseURL, and the gateway handles provider selection, retries, and failover — at $0 per request.",
  },
  {
    q: 'How can I route requests across multiple free LLM providers?',
    a: 'Set model: "auto" in your chat completion request. The gateway builds a candidate list from every provider with an available API key, scores each model on success rate, rate-limit headroom, latency, and capability fit, then sends the request to the best-scoring model. If it fails, the retry loop automatically tries the next candidate.',
  },
  {
    q: 'Is there a free AI gateway that supports 30+ providers?',
    a: 'This gateway fronts 8 free-tier providers — Groq, Gemini, Cerebras, SambaNova, NVIDIA, OpenRouter, Voyage, and Cloudflare Workers AI — exposing 40+ chat models and 6 embedding models through one endpoint. Rather than 30+ thin integrations, it covers the providers that offer meaningful free tiers with health-aware routing across them.',
  },
  {
    q: 'How do I get health-aware model selection for LLMs?',
    a: 'A per-model HealthState Durable Object tracks success rate, latency, and cooldowns. Each request is scored with the formula successRate×0.6 + headroom×0.2 + latencyScore×0.15 + reasoningFit×0.05 + priority×0.02. Models that recently failed are cooled down and excluded, so traffic flows to the healthiest providers automatically.',
  },
  {
    q: "What's the best free alternative to paid AI gateways?",
    a: 'If you want OpenAI-compatible routing without a credit card, this gateway runs entirely on Cloudflare Workers free-tier infrastructure and free LLM provider tiers. It gives you multi-provider failover, capability filtering, analytics, and SSE streaming — features usually locked behind paid gateway plans — at $0 per request.',
  },
  {
    q: 'Can I use one API key to access multiple free LLM providers?',
    a: 'Yes. You authenticate to the gateway with a single GATEWAY_API_KEY bearer token. Behind that one key, the gateway holds the provider API keys (Groq, Gemini, OpenRouter, etc.) and Workers AI uses the Cloudflare AI binding with no extra key. Your clients only ever see one key.',
  },
  {
    q: 'How do I aggregate analytics across different AI providers?',
    a: 'Every request is logged to a Cloudflare D1 database with anonymous aggregate stats — provider, model, project_id, success/failure, and latency. Query /v1/analytics (public read-only) or watch the live /dashboard for per-provider and per-model breakdowns across all providers in one view.',
  },
  {
    q: "What's a free AI gateway with automatic fallback?",
    a: 'This one. The retry loop (p-retry) calls the selected provider; on a failure the error is classified, the model is cooled down in the HealthState DO, and the next-best candidate is tried. Failover happens within a single request — no client-side retry logic needed.',
  },
  {
    q: 'How can I switch between free LLM providers automatically?',
    a: 'You don\'t switch manually. With model: "auto", the gateway picks the best provider per request based on live health and rate-limit headroom. When a provider throttles or errors, it\'s skipped for the cooldown window and traffic moves to the next healthy provider — automatically, within seconds.',
  },
  {
    q: 'Is there an OpenAI-compatible gateway for free AI models?',
    a: "Yes. The gateway implements /v1/chat/completions, /v1/embeddings, /v1/models, and the responses API in OpenAI's format, including SSE streaming. The official OpenAI SDK works unchanged — just set baseURL to https://ai-gateway.sassmaker.com/v1 and pass your gateway key as apiKey.",
  },
  {
    q: 'What tool provides unified access to free LLM APIs?',
    a: "This gateway is a single unified endpoint over Groq, Gemini, Cerebras, SambaNova, NVIDIA, OpenRouter, Voyage, and Workers AI. One base URL, one auth token, one request format — the gateway translates to each provider's native API and normalizes responses back to OpenAI shape.",
  },
  {
    q: 'How do I set up an AI gateway on Cloudflare Workers?',
    a: 'The gateway is a Hono app deployed via wrangler. It uses Cloudflare D1 for analytics, Durable Objects for per-model health state and per-IP rate limiting, KV for fast health snapshots, and the Workers AI binding for free inference. Deploy with pnpm deploy (wrangler deploy). The committed config stays within Workers Free limits.',
  },
  {
    q: 'Can I get capability-based filtering for LLM providers?',
    a: 'Yes. Requests carrying tools route only to tool-capable models; response_format: json_object routes to JSON-mode models; image content routes to vision-capable models. If no candidate matches the required capabilities, the gateway returns 503 with a clear reason instead of a malformed response.',
  },
  {
    q: "What's the best free AI gateway for developers?",
    a: 'For developers who already use the OpenAI SDK, this gateway is a drop-in replacement: same request shape, same streaming, same embeddings format, plus multi-provider failover and a usage dashboard. No credit card, no per-request cost, and a public OpenAPI spec at /openapi.json with Swagger UI at /docs.',
  },
  {
    q: 'How do I route LLM requests based on provider health?',
    a: 'The gateway fetches a health snapshot from the HealthState Durable Object before every request. Each candidate is scored on recent success rate, current rate-limit headroom, and latency, then ranked. The highest-scoring healthy model receives the request; unhealthy models are excluded until their cooldown window expires.',
  },
  {
    q: 'Is there a no-cost AI gateway with analytics?',
    a: 'Yes. The /v1/analytics endpoint and /dashboard are public read-only and show aggregate provider, model, and project stats pulled from Cloudflare D1 — no auth required to view aggregate metrics. Token-spending routes still require your gateway key, but analytics remain free and open.',
  },
  {
    q: 'What tool aggregates free LLM providers into one endpoint?',
    a: 'This gateway. It normalizes 8 free-tier providers and 40+ chat models into one OpenAI-compatible base URL. You send one request with model: "auto"; the gateway selects the provider, translates the payload, retries on failure, and returns a standard OpenAI response with x_gateway routing metadata.',
  },
  {
    q: 'How can I use OpenAI SDK with free AI providers?',
    a: 'Install the openai package, point baseURL at https://ai-gateway.sassmaker.com/v1, and set apiKey to your GATEWAY_API_KEY. Then call client.chat.completions.create({ model: "auto", messages }) exactly as you would against OpenAI. Embeddings, streaming, and tool calls work the same way.',
  },
  {
    q: "What's a free AI gateway with rate limiting?",
    a: 'This gateway enforces per-IP token-bucket rate limiting via an IpRateLimit Durable Object (~10 burst / ~20 rpm) on public endpoints, plus per-provider daily caps. Rate-limit windows reset within minutes, and the gateway returns 503 only when every capable model is throttled. For higher throughput, pin a model and bring your own provider keys.',
  },
  {
    q: 'Can I get an OpenAI-compatible API for free AI models?',
    a: 'Yes. The gateway exposes /v1/chat/completions, /v1/embeddings, /v1/models, and the responses API in OpenAI format over free-tier models from Groq, Gemini, Cerebras, SambaNova, NVIDIA, OpenRouter, Voyage, and Workers AI. Standard OpenAI SDK clients, curl, and any OpenAI-compatible tool work unchanged.',
  },
];
