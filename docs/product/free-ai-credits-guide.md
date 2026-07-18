# Free AI Credits Guide for Indie Developers

No VC funding? No problem. Here's every source of free AI API credits available in 2025-2026, organized by effort required.

---

## Tier 1: Always-Free (Just Sign Up)

These are genuinely free, no application needed, and recurring.

Providers marked with **[integrated]** are built into this gateway — just add the API key and they auto-activate.

| Provider | What You Get | Best For | URL |
|----------|-------------|----------|-----|
| **Google AI Studio** [integrated] | Gemini 2.5 Pro/Flash, 15 RPM, ~1000 req/day | Best free tier anywhere. Tool calling, vision, 1M context | https://aistudio.google.com |
| **Groq** [integrated] | Llama 70B, Qwen3, Kimi K2, etc. Rate-limited free | Fastest inference. Tool calling + JSON mode | https://console.groq.com |
| **Cerebras** [integrated] | Up to 24M tokens/day free | Extremely fast Llama inference | https://cloud.cerebras.ai |
| **Cloudflare Workers AI** [integrated] | 10,000 neurons/day, 20+ models | Embedding + chat, zero config | https://developers.cloudflare.com/workers-ai |
| **SambaNova** [integrated] | Free tier, Llama 70B, DeepSeek V3, Qwen3 | Fast inference on custom hardware | https://cloud.sambanova.ai |
| **Zhipu AI (GLM)** [integrated] | GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash all **free** | Free vision model, free tool calling | https://open.bigmodel.cn/usercenter/apikeys |
| **NVIDIA NIM** [integrated] | Free tier, Llama 70B, DeepSeek R1, Qwen3 | Huge model catalog, ~40 RPM | https://build.nvidia.com |
| **OpenRouter** [integrated] | 25+ free models, 50 req/day | Multi-model access, single API | https://openrouter.ai |
| **Cohere** | Trial API key, 20 calls/min, 1000/month | Embed, Rerank, Command models | https://dashboard.cohere.com |
| **HuggingFace** | Free serverless inference, thousands of models | Open-source model experimentation | https://huggingface.co/inference-api |
| **Mistral** | Free tier for Mistral Small | European provider, good quality | https://console.mistral.ai |
| **Modal** | $30/month free compute credits | Self-host any open-source LLM | https://modal.com |

### Chinese Providers with Free Tiers (No Chinese Phone Needed)

| Provider | Free Offer | Signup | URL |
|----------|-----------|--------|-----|
| **DeepSeek** | Free tier resets monthly, no credit card needed | Email | https://platform.deepseek.com |
| **Alibaba Qwen** | 1M tokens free per model (90 days) | Alibaba Cloud account | https://www.alibabacloud.com/en/product/modelstudio |
| **Zhipu GLM** | Multiple free models + signup credits | Email at z.ai | https://z.ai |
| **SiliconFlow** | $1 free credits + several free models | Email | https://www.siliconflow.com |
| **01.AI (Yi)** | Free tokens on signup | Email | https://platform.01.ai |

---

## Tier 2: Signup Bonuses (One-Time Credits)

Small credits for creating an account.

| Provider | Credits | Expires | URL |
|----------|---------|---------|-----|
| **OpenAI** | $5 | ~3 months | https://platform.openai.com |
| **Together AI** | $5 | 30-90 days | https://api.together.ai |
| **Fireworks AI** | $1-5 | Varies | https://fireworks.ai |
| **NVIDIA NIM** | 1,000 API calls | Varies | https://build.nvidia.com |

---

## Tier 3: Startup Credit Programs (No VC Required)

These require a "startup" application but **do NOT require VC funding**. A domain, website, and project description are enough.

| Program | Credits | Includes | Requirements | URL |
|---------|---------|----------|-------------|-----|
| **Google Cloud for Startups** (Founders) | $2,000 | Vertex AI, Gemini API, all GCP | Domain + website + startup description | https://cloud.google.com/startup |
| **AWS Activate** (Founders) | $1,000 | Bedrock (Claude, Llama, Titan) + all AWS. 2-year validity | AWS account + website + brief application | https://aws.amazon.com/activate |
| **Microsoft Founders Hub** | $1,000-5,000 | Azure OpenAI (GPT-4, GPT-4o) + all Azure | Website + application. "No funding required, no pitch deck" | https://www.microsoft.com/startups |
| **OVHcloud Startup** | Up to $10,000 | GPU instances for AI workloads | Startup < 5 years old, EU-friendly | https://startup.ovhcloud.com |
| **Oracle Cloud Startup** | Up to $10,000 | GPU instances | Application | https://www.oracle.com/startup |

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
| Zhipu GLM free models | Unlimited (rate-limited) | Free forever |
| DeepSeek free tier | Resets monthly | Generous for development |
| **Total** | **~1B+ tokens/month** | More than enough for development |

With cloud startup credits stacked on top, you can run production workloads for 1-2 years before needing to pay anything.
