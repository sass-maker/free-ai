# Cheap Models Guide: Chinese Models, Gemini & Fixed-Price Plans

A practical guide to the cheapest capable LLM APIs for building agentic systems.

---

## TL;DR: Price Comparison (per 1M tokens)

| Model | Input | Output | Tool Calling | JSON Mode | Vision | Context |
|-------|------:|-------:|:---:|:---:|:---:|--------:|
| **DeepSeek V3.2** | $0.28 | $0.42 | Y | Y | | 128K |
| **DeepSeek V3.2** (cached) | $0.028 | $0.42 | Y | Y | | 128K |
| Alibaba Qwen-Flash | $0.05 | $0.40 | Y | Y | | 128K |
| Zhipu GLM-4.7-Flash | **FREE** | **FREE** | Y | Y | | 128K |
| StepFun 3.5 Flash | $0.10 | $0.30 | Y | Y | | 262K |
| MiniMax M2.5 | $0.16 | $1.10 | Y | Y | | 128K |
| Moonshot Kimi K2.5 | $0.60 | $2.50 | Y | Y | | 256K |
| SiliconFlow (DeepSeek) | $0.27 | $0.42 | Y | Y | | 128K |
| Gemini 2.5 Flash | **FREE** | **FREE** | Y | Y | Y | 1M |
| Gemini 2.5 Pro | **FREE** | **FREE** | Y | Y | Y | 1M |
| |||||||
| *For comparison:* |||||||
| Claude Sonnet 4 | $3.00 | $15.00 | Y | Y | Y | 200K |
| GPT-4o | $2.50 | $10.00 | Y | Y | Y | 128K |

**DeepSeek is 10-35x cheaper than Claude/GPT-4o.** Chinese models are 5-50x cheaper for comparable quality.

---

## Chinese Models (International Access)

### DeepSeek — The Price/Performance King

| Model | Input/1M | Output/1M | Notes |
|-------|---------|----------|-------|
| deepseek-chat (V3.2) | $0.28 | $0.42 | Cache hits drop input to $0.028 |
| deepseek-reasoner (R1) | $0.55 | $2.19 | Chain-of-thought reasoning |

- **API**: OpenAI-compatible. Also supports Anthropic format.
- **Signup**: Email (no Chinese phone). https://platform.deepseek.com
- **Tool calling**: Yes, reliable
- **JSON mode**: Yes
- **Context**: 128K input, up to 64K output
- **Gotcha**: China-based infra. Latency can spike to 7s+ under load. Has had 12-hour outages. **Use via Groq, OpenRouter, Together, or SiliconFlow for better reliability.**

#### DeepSeek Free Tier Details

| | Details |
|---|---|
| **Signup credits** | ~10M tokens (~$2-5 worth) on new account |
| **Credit card required** | No |
| **Expiration** | 1-2 months after signup |
| **Ongoing free tier** | **No** — once credits expire, you pay per token |
| **Free tier rate limits** | 2-10 RPM (varies with server load) |
| **Paid rate limits** | Higher RPM, scales with spend |
| **Model access** | Full — both deepseek-chat and deepseek-reasoner |
| **Capability difference** | None — free and paid get same models and features |

**Verdict**: Not a real free tier — it's trial credits. Good for testing, but you'll hit the wall in 1-2 months. The paid pricing is so cheap ($0.28/M) that even $5/month goes very far (~18M tokens).

### Alibaba Qwen — Broadest Model Lineup

| Model | Input/1M | Output/1M | Notes |
|-------|---------|----------|-------|
| Qwen-Flash | $0.05 | $0.40 | Best bang for buck |
| Qwen-Plus | $0.40 | $1.20 | Mid-tier |
| Qwen-Max | $1.20 | $6.00 | Frontier quality |
| QwQ-Plus (reasoning) | $0.80 | $2.40 | Reasoning model |
| Qwen3 (various) | $0.11-$0.70 | $0.42-$2.80 | Latest generation |

- **API**: OpenAI-compatible endpoint available via DashScope
- **Signup**: Alibaba Cloud account, no Chinese phone. https://www.alibabacloud.com/en/product/modelstudio

#### Qwen Free Tier Details

| | Details |
|---|---|
| **Free tokens** | 1M tokens **per model, per account** (e.g., 5 models = 5M tokens total) |
| **Qualifying models** | Qwen-Turbo, Qwen-Plus, Qwen-Max, Qwen-Long, Qwen3 variants |
| **Expiration** | 180 days (6 months) from activation |
| **Ongoing free tier** | **No** — pay per token after free allocation is used |
| **Credit card required** | Alibaba Cloud account required (may need payment method on file) |
| **Free tier rate limits** | ~60 RPM, 100K-300K TPM depending on model |
| **New account bonus** | Alibaba Cloud sometimes gives $300-400 cloud credits for new signups (2-3 month expiry), usable for Model Studio |
| **Capability difference** | None — same models and features |

**Verdict**: More generous than DeepSeek's free tier — 1M tokens per model with 6-month validity, plus potentially $300+ in cloud credits for new Alibaba Cloud accounts. Rate limits (60 RPM) are much better than DeepSeek's free tier. The paid Qwen-Flash at $0.05/M input is the cheapest capable model with tool calling anywhere.

### Zhipu AI (GLM) — Actually Free Models

| Model | Input/1M | Output/1M | Notes |
|-------|---------|----------|-------|
| GLM-4.7-Flash | **FREE** | **FREE** | Best free model with tool calling |
| GLM-4.5-Flash | **FREE** | **FREE** | Also free |
| GLM-4.6V-Flash | **FREE** | **FREE** | Free vision model |
| GLM-4.7-FlashX | $0.07 | $0.40 | Cheap paid option |
| GLM-4.7 | $0.60 | $2.20 | Premium |
| GLM-5 | $1.00 | $3.20 | Frontier |

- **API**: OpenAI-compatible. https://z.ai
- **Signup**: Email, no Chinese phone for z.ai international
- **Tool calling**: Yes
- **JSON mode**: Yes
- **Best for**: **Only Chinese provider with truly perpetual free models.** GLM-4.7-Flash with tool calling for $0, forever.

### Moonshot AI (Kimi)

| Model | Input/1M | Output/1M | Notes |
|-------|---------|----------|-------|
| Kimi K2.5 | $0.60 | $2.50 | Latest, reasoning mode available |
| Kimi K2.5 (cached) | $0.15 | $2.50 | 75% cheaper input with caching |

- 256K context window, tool calling, JSON mode
- **Signup**: Credit card (Visa/MC accepted), min $1 deposit
- Available on Groq as `moonshotai/kimi-k2-instruct` (free via Groq)

### MiniMax

| Model | Input/1M | Output/1M |
|-------|---------|----------|
| M2.5 | $0.16 | $1.10 |
| M2.7 | $0.30 | $1.20 |

- OpenAI + Anthropic API compatible
- Available on OpenRouter and SiliconFlow

### StepFun

| Model | Input/1M | Output/1M | Notes |
|-------|---------|----------|-------|
| Step 3.5 Flash | $0.10 | $0.30 | 262K context, 65K max output |

- OpenAI-compatible, international endpoint
- Available **free on OpenRouter** (rate-limited)

### Aggregator: SiliconFlow

One OpenAI-compatible API for all Chinese models:

- **URL**: https://www.siliconflow.com
- **Free**: $1 signup credits + several free models
- Hosts: DeepSeek, GLM, Kimi, StepFun, Qwen, Llama, and more
- No Chinese phone needed
- Best single entry point to avoid individual provider signup friction

---

## Google Gemini — Best Free Tier

Gemini's free tier is absurdly generous and the best option for agentic development.

| Model | Tier | RPM (free) | Daily Limit | Tool Calling | Vision | Context |
|-------|------|-----------|-------------|:---:|:---:|--------:|
| Gemini 2.5 Pro | Frontier | 5 | ~50 | Y | Y | 1M |
| Gemini 2.5 Flash | Fast | 15 | ~500 | Y | Y | 1M |
| Gemini 2.0 Flash | Fast | 15 | ~1000 | Y | Y | 1M |
| Gemini 2.0 Flash-Lite | Fastest | 30 | ~1500 | Y | Y | 1M |
| Gemini 2.5 Flash-Lite | Fastest | 30 | ~1500 | Y | Y | 1M |

**All free. All support tool calling, JSON mode, and vision. 1M token context.**

**Paid pricing** (if you exceed free tier):

| Model | Input/1M | Output/1M |
|-------|---------|----------|
| Gemini 2.5 Pro | $1.25 | $10.00 |
| Gemini 2.5 Flash | $0.15 | $0.60 |
| Gemini 2.0 Flash | $0.10 | $0.40 |

Gemini Flash paid ($0.15/M in) is cheaper than DeepSeek ($0.28/M in) with better reliability and 1M context.

---

## Fixed Monthly Pricing (Not Per-Token)

Very few providers offer this. Here's what exists:

### Awan LLM — True Unlimited Tokens

| Plan | Price/mo | Rate Limit | Daily Requests (Small/Med/Large) |
|------|---------|-----------|----------------------------------|
| Lite | **Free** | 20/min | 200 / 10 / 10 |
| Core | $5 | 20/min | 5,000 / 3,000 / 10 |
| Plus | $10 | 50/min | 10,000 / 6,000 / 2,000 |
| Pro | $20 | 100/min | 80,000 / 40,000 / 30,000 |
| Max | $80 | 200/min | Unlimited |

- **Models**: Llama 3.1 8B & 70B (open-source only)
- **Genuinely unlimited tokens** — no token metering
- **Catch**: Limited to open-source models, not frontier quality
- **URL**: https://www.awanllm.com

### Abacus AI (ChatLLM)

| Plan | Price/mo | Credits | Models |
|------|---------|---------|--------|
| Basic | $10 | 20,000 credits | GPT-4o, Gemini, Grok, GLM, Llama 4, etc. |
| Pro | $20 | 30,000 credits | Same + unlimited DeepAgent |
| Teams | $10/user | Unlimited | All models |

- Multi-model access through one subscription
- **URL**: https://abacus.ai

### Everyone Else: Per-Token Only

| Provider | Subscription | But... |
|----------|-------------|--------|
| OpenAI | ChatGPT Plus $20/mo | Web only, NOT API credits |
| Anthropic | Claude Pro $20/mo | Web only, NOT API credits |
| Mistral | Le Chat Pro $15/mo | Web only, NOT API credits |
| Perplexity | Pro $20/mo | Search product, NOT API credits |

**Fixed-price API access is rare.** GPU costs scale with usage, so providers can't afford flat-rate pricing on frontier models.

---

## Recommendation for Agentic Systems

### Development Phase (Spend $0)

Use this gateway + free tiers:
1. **Gemini 2.5 Flash** (free) — primary agent brain, tool calling + vision
2. **Groq Llama/Kimi** (free) — fast fallback, tool calling
3. **Zhipu GLM-4.7-Flash** (free) — perpetually free tool-calling model
4. **This gateway** — auto-routes between all of them

### Production Phase (Spend $5-50/month)

| Budget | Best Option | Why |
|--------|-----------|-----|
| $5/mo | Awan LLM Core ($5) + free tiers | Unlimited Llama tokens + free Gemini/Groq |
| $10-20/mo | DeepSeek API | 25-50M tokens/month. Best quality per dollar. |
| $20-50/mo | Gemini Flash paid ($0.15/M in) | Most reliable, 1M context, vision, tool calling |
| $50-100/mo | DeepSeek + Claude Haiku hybrid | DeepSeek for volume, Claude for complex reasoning |

### When to Pay for Claude/GPT-4o ($100+/mo)

Only if you need:
- **Complex multi-step reasoning** that cheaper models fail at
- **Reliable, low-variance tool calling** in production
- **SLA and uptime guarantees** for paying customers
- **Frontier coding ability** (Claude Opus/Sonnet for code generation)

For most agentic use cases, **DeepSeek + Gemini Flash covers 90% of what Claude/GPT-4o can do at 5-10% of the cost.**
