# Free AI Credits Guide for Indie Developers

No VC funding? No problem. Here's every source of free AI API credits available in 2025-2026, organized by effort required.

Last reviewed: 2026-08-07.

---

## Tier 1: Always-Free (Just Sign Up)

These are genuinely free, no application needed, and recurring.

Providers marked **[integrated]** are built into this gateway — just add the API key and they auto-activate. Providers marked **[opportunity]** are not yet wired into the gateway but expose an OpenAI-compatible endpoint and are good candidates for a new adapter (see [Not integrated — evaluated and rejected for low ROI](#not-integrated-evaluated-and-rejected-for-low-roi)).

| Provider | What You Get | Best For | URL |
|----------|-------------|----------|-----|
| **Google AI Studio** [integrated] | Gemini 3 Flash (recommended default), 2.5 Pro/Flash, 10-15 RPM, ~1500 req/day, 1M context | Best free tier anywhere. Tool calling, vision | https://aistudio.google.com |
| **Groq** [integrated] | Llama, Qwen3, Kimi K2, GPT-OSS, Whisper. 30 RPM, 1K-14K req/day | Fastest inference. Tool calling + JSON mode | https://console.groq.com |
| **Cerebras** [integrated] | Up to 24M tokens/day free | Extremely fast Llama inference | https://cloud.cerebras.ai |
| **Cloudflare Workers AI** [integrated] | 10,000 neurons/day, 20+ models | Embedding + chat, zero config | https://developers.cloudflare.com/workers-ai |
| **SambaNova** [integrated] | Free tier, Llama 70B, DeepSeek V3, Qwen3 | Fast inference on custom hardware | https://cloud.sambanova.ai |
| **NVIDIA NIM** [integrated] | Free tier, Llama 70B, DeepSeek R1, Qwen3 | Huge model catalog, ~40 RPM | https://build.nvidia.com |
| **OpenRouter** [integrated] | 25+ free models, 50 req/day | Multi-model access, single API | https://openrouter.ai |
| **GitHub Models** [integrated] | Rate-limited free usage for GitHub accounts | Free for any GitHub user | https://github.com/marketplace/models |
| **Pollinations** [integrated] | Free text + image generation, no key required | Zero-config fallback, image gen | https://pollinations.ai |
| **Cohere** [integrated] | Trial API key, 20 calls/min, 1000/month | Embed, Rerank, Command models | https://dashboard.cohere.com |
| **Mistral** [integrated] | Free tier for Mistral Small | European provider, good quality | https://console.mistral.ai |
| **Together AI** [integrated: images/video] | FLUX image gen + video; chat reachable via OpenRouter | Image/video generation | https://api.together.ai |
| **Voyage AI** [integrated: embeddings] | Free embedding tier | High-quality embeddings | https://www.voyageai.com |
| **Z.ai / Zhipu GLM** [integrated] | GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash all **free** | Free vision model, free tool calling | https://z.ai |
| **ModelScope** [staged, inactive] | Selected models advertise at least 50 free invocations/day | Additional direct Qwen capacity after smoke | https://www.modelscope.cn/learn/434591 |
| **HuggingFace** | Free serverless inference, thousands of models | Open-source model experimentation | https://huggingface.co/inference-api |
| **Modal** | $30/month free compute credits | Self-host any open-source LLM | https://modal.com |

### Notes on the Chinese providers

DeepSeek, Z.ai, Alibaba Qwen, SiliconFlow, and 01.AI all expose OpenAI-compatible endpoints and accept email-only signup (no Chinese phone). They are reachable directly from outside China. DeepSeek V4 (`deepseek-v4-flash`, `deepseek-v4-pro`) shipped April 2026 with a 1M context window; the legacy `deepseek-chat` / `deepseek-reasoner` names are deprecated 2026/07/24 — use the V4 names in any new adapter.

---

## Not integrated — evaluated and rejected for low ROI

The following OpenAI-compatible providers were evaluated and deliberately kept
out of routing. ModelScope has a staged disabled seed. SiliconFlow has a staged
adapter but no model candidate, and still requires a verified zero-price model
plus catalog/smoke evidence before activation.

| Provider | Why rejected | What would change the verdict |
|----------|-------------|------------------------------|
| **DeepSeek** | The "free" offer is a one-time 5M-token grant (~$3-8, 30 days, then paid). Not a recurring free tier. After the grant it's just another paid provider — cheap, but not free, and we already have free frontier-class routing via Groq/Cerebras/Gemini/Z.ai. | A genuine recurring free tier (not a one-time grant) for a model we don't already route for free |
| **SiliconFlow routing candidate** | The adapter is ready, but the current official `Qwen/Qwen3-8B` page lists $0.06/M input and output tokens. A generic free-model rate-limit policy is not evidence that this model is free. | An official zero-price chat model confirmed through the authenticated catalog and account billing UI |
| **Alibaba Qwen / DashScope** | 1M tokens per model, 90 days, then paid. Qwen3 already reachable via Groq/Cerebras/OpenRouter | A permanent free Qwen variant not available through existing providers |
| **01.AI (Yi)** | Vague "free signup tokens," small. Yi-large/lightning aren't frontier | A free Yi tier with frontier-class quality and clear limits |
| **OVH AI Endpoints** | Same Llama 3.1 70B/8B we already have via Groq/Cerebras/SambaNova/OpenRouter. Only novel value is EU residency, which isn't a routing concern for this gateway | A model on OVH that we can't reach through existing providers, or a hard EU-residency product requirement |
| **Reka** | Free tier size unclear; Reka has been less reliable. Multimodal is the only angle, but Gemini (already integrated) covers vision for free at higher quality | A stable, published recurring free tier with a capability gap we actually have |
| **Kilo / LLM7 / AI Horde / Requesty** | Small catalogs or unstable quotas; pure redundancy or hobby-tier | A model we need that isn't available anywhere else |

For the one provider that did clear the bar (Z.ai), the integration follows `src/providers/openai-compatible.ts` and the resilience rules in [`docs/architecture/decisions/adr-001-007.md`](../architecture/decisions/adr-001-007.md) (timeouts, jitter, input validation, cost budgets, degraded labels).

---

## Tier 2: Signup Bonuses (One-Time Credits)

Small credits for creating an account.

| Provider | Credits | Expires | URL |
|----------|---------|---------|-----|
| **OpenAI** | $5 | ~3 months | https://platform.openai.com |
| **Together AI** | $5 | 30-90 days | https://api.together.ai |
| **Fireworks AI** | $1-5 | Varies | https://fireworks.ai |
| **NVIDIA NIM** | 1,000 API calls | Varies | https://build.nvidia.com |
| **DeepSeek** | 5M tokens (~$3-8) | 30 days | https://platform.deepseek.com |

---

## Tier 3: Startup Credit Programs (No VC Required)

These require a "startup" application but **do NOT require VC funding**. A domain, website, and project description are enough.

| Program | Credits | Includes | Requirements | URL |
|---------|---------|----------|-------------|-----|
| **Google Cloud for Startups** (Founders) | $2,000 | Vertex AI, Gemini API, all GCP | Domain + website + startup description | https://cloud.google.com/startup |
| **AWS Activate** (Founders) | $1,000 | Bedrock (Claude, Llama, Titan) + all AWS. 2-year validity | AWS account + website + brief application | https://aws.amazon.com/activate |
| **Microsoft Founders Hub** | $1,000-5,000 | Azure OpenAI (GPT-4, GPT-4o) + all Azure | Website + application. "No funding required, no pitch deck" | https://www.microsoft.com/startups |
| **OVHcloud Startup** | Up to $10,000 | GPU instances for AI workloads | Startup < 5 years old, EU-friendly | https://startup.ovhcloud.com |
| **Oracle Cloud Startup** | Up to $10,000 | GPU instances | Application | https://www.oracle.com/startups |

**Combined potential: $4,000-$28,000 in credits** by applying to all of these with just a domain and project.

### Tips for Startup Credit Applications

1. **Use a custom domain email** (not gmail) for applications
2. **Have a landing page** with a clear value proposition
3. **Describe a real product** — "AI-powered X for Y" works better than "I'm experimenting"
4. **Apply to all three major clouds** (GCP, AWS, Azure) — they don't share applicant data
5. **Time your applications** — apply when you're ready to use credits, they expire in 1-2 years

---

## Tier 4: Hackathon & Event Credits

| Source | Typical Credits | How to Get | URL |
|--------|----------------|-----------|-----|
| **lablab.ai hackathons** | $25-300 per event (from Anthropic, OpenAI, Cohere, etc.) | Register + submit a project | https://lablab.ai |
| **MLH hackathons** | Sponsor credits (varies) | Participate | https://mlh.io |
| **Devpost hackathons** | Sponsor credits (varies) | Participate | https://devpost.com |
| **Google I/O, DevFest** | $50-300 GCP credits | Attend events, complete codelabs | https://developers.google.com |

---

## Tier 5: Open-Source & Education

| Program | What You Get | Requirements |
|---------|-------------|-------------|
| **GitHub Education Pack** | OpenAI credits, Azure credits, Copilot free | Must be a verified student |
| **HuggingFace OSS Program** | Free GPU compute, Inference Endpoints | Maintain a significant OSS project |
| **Replicate** | Free hosting for published models | Publish an open-source model |

---

## Best Strategy: Stack Everything

Here's the optimal order for an indie developer:

1. **Sign up for all free tiers** (Tier 1) — covers 90% of development needs
2. **Grab signup bonuses** (Tier 2) — extra $10-15 in credits
3. **Apply for cloud credits** (Tier 3) — $4K-28K combined
4. **Join hackathons** (Tier 4) — bonus credits every few months
5. **Use this gateway** — aggregates all free providers behind one API

### Monthly Token Budget (Free Only)

| Source | Approx. Monthly Tokens | Notes |
|--------|----------------------|-------|
| Google AI Studio | ~30M+ | Rate-limited, not token-limited |
| Groq | ~100M+ | Very generous free tier |
| Cerebras | ~720M | 24M/day * 30 days |
| Cloudflare Workers AI | ~300K neurons (varies) | Daily reset |
| Zhipu GLM free models | Unlimited (rate-limited) | Free forever (via Cerebras today; direct adapter pending) |
| DeepSeek free grant | 5M tokens (one-time per account) | Per new account, 30-day window |
| **Total** | **~1B+ tokens/month** | More than enough for development |

With cloud startup credits stacked on top, you can run production workloads for 1-2 years before needing to pay anything.
