# agents.md — free-ai

## Shared Fleet Standard

Also read and follow the shared fleet-level agent standard at `../AGENTS.md`. Treat this repository as owned product code: protect production stability, keep changes scoped, verify work, and record durable follow-up tasks when something remains incomplete or blocked.

## Purpose
OpenAI-compatible API gateway on Cloudflare Workers — routes requests across 30+ free LLM providers with health-aware model selection, capability filtering, per-IP rate limiting, and aggregate analytics.

## Stack
- Framework: Hono + CF Workers (`@hono/zod-openapi` for typed routes + Swagger UI at `/docs`)
- Language: TypeScript (strict, ESM, ES2022)
- DB: Cloudflare D1 (SQLite) — anonymous aggregate analytics (`GATEWAY_DB`)
- Auth: `GATEWAY_API_KEY` Bearer required on all `/v1/*` routes except a small read-only allowlist (`/v1/models`, `/v1/stats/providers`, `/v1/dashboard`, `/v1/budget`). `/v1/analytics` IS now enforced — it exposes provider/project load.
- Testing: Vitest (unit), Playwright (e2e mock + live smoke)
- Deploy: Cloudflare Workers via `wrangler deploy`
- Package manager: pnpm

## Repo structure
```
src/
  index.ts              # Hono app + all route handlers (monolithic, ~55KB — known TODO to split)
  config.ts             # Model registry (30+ chat + 6 embedding models), tier ordering
  types.ts              # Shared types (Env, ModelCandidate, Provider)
  dashboard-html.ts     # Bundled HTML for /dashboard
  providers/            # One file per provider (groq, gemini, workers-ai, openrouter, cerebras, etc.)
  router/
    select-model.ts     # Health-aware scoring + candidate selection
    classify-error.ts   # Error classification for retry/cooldown
  state/
    health-do.ts        # HealthStateDO: per-model success rate, latency, cooldowns
    ip-rate-limit-do.ts # IpRateLimitDO: token-bucket per IP (10 burst / ~20 rpm)
    client.ts           # DO client helpers
  utils/
    request.ts          # Request normalization
    sse.ts              # SSE streaming helpers
playground/             # Vite + React 19 demo SPA (served via ASSETS binding)
site/                   # Astro docs/marketing (separate package.json)
migrations/             # D1 SQL migrations (0001–0005)
scripts/                # Deploy, env sync, model ID validation
test/                   # Vitest unit tests
e2e/                    # Playwright e2e (mock server)
e2e-live/               # Playwright e2e (live deployed gateway)
examples/               # Node.js + Python OpenAI SDK usage examples
wrangler.toml           # CF config: D1, KV, Durable Objects, AI binding, assets
```

## Key commands
```bash
pnpm dev                  # wrangler dev --remote (uses remote CF resources)
pnpm dev:local            # sync env vars + wrangler dev --local
pnpm deploy               # wrangler deploy (production)
pnpm test                 # vitest run
pnpm test:watch           # vitest watch
pnpm test:e2e             # playwright (mock e2e)
pnpm test:e2e:live        # playwright against live gateway
pnpm typecheck            # tsc --noEmit
pnpm check                # typecheck + unit tests
pnpm build                # build playground Vite SPA
node scripts/sync-dev-vars.mjs  # sync .env to wrangler dev vars
```

## Architecture notes
- **Request flow**: IP rate limit → parse/validate (Zod) → build model registry from available API keys → fetch health snapshots from `HealthStateDO` → `selectCandidates()` scores + ranks → retry loop (`p-retry`) calling provider → return OpenAI-format response with `x_gateway` metadata.
- **Scoring formula**: `successRate×0.6 + headroom×0.2 + latencyScore×0.15 + reasoningFit×0.05 + priority×0.02`. Failed models cooled down and excluded.
- **Capability filtering**: requests with `tools` → tool-capable models only; `response_format: json_object` → JSON-mode only; image content → vision-capable only. Returns 503 if no capable model available.
- **Auth note**: `/v1/analytics` now requires the `GATEWAY_API_KEY` Bearer token (removed from `AUTH_EXEMPT_GET`) — it exposes provider/project load and is no longer public.
- **Known gaps**: `model=auto` vision routing: **verified working** (2026-04-25) — image payloads correctly route to vision-capable models via `deriveRequiredCapabilities` + `supportsVisionInput` in `select-model.ts`.
- **tsconfig**: was broken (no `include`, no workers types, `noPropertyAccessFromIndexSignature` conflict) — fixed 2026-04-25. Now typechecks clean with `@cloudflare/workers-types`, `e2e-live` excluded (it needs `@types/node` which isn't installed and runs locally only).
- **State**: single global `HealthStateDO`; per-IP `IpRateLimitDO`. KV (`HEALTH_KV`) for fast health snapshots.
- **Providers requiring API keys**: OpenRouter, Cerebras, SambaNova, NVIDIA, Groq, Gemini, Voyage. Workers AI uses CF AI binding (no extra key).
- **30+ chat models + 6 embedding models** in config registry.
- **Monolithic `index.ts`** (~55KB) — splitting is a known TODO.
- `site/` is an Astro site with its own `package.json`; managed separately.
- Playground Vite SPA served via `ASSETS` binding in `wrangler.toml`.

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Add durable work items in SaaS Maker Cockpit Tasks when the task affects product behavior, deployment, user feedback, or fleet maintenance.
- Include the project slug, a concise title, acceptance criteria, priority/status, and links to relevant code, issues, traces, or dashboards.
- If task discovery starts locally in an editor or agent session, mirror the durable next step back into SaaS Maker before handoff.

### Using SaaS Maker
- Treat SaaS Maker as the system of record for project metadata, feedback, tasks, analytics, testimonials, changelog, and fleet visibility.
- Prefer API-first workflows through `fnd api`, the SDK, or widgets instead of one-off scripts when interacting with SaaS Maker features.
- Keep this agent file aligned with the project record when operating rules, integrations, or deployment conventions change.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai` gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost, reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->

## Active context
