# Local Development

## Prerequisites

- Node.js 22+
- pnpm 10.33.2 (declared in `package.json` `packageManager`; `corepack enable` will pick it up)
- Cloudflare account for `wrangler dev --remote` (uses live D1/KV/DO bindings)

## First setup

```bash
pnpm install
cp .env.example .env          # fill provider keys you want to test
pnpm dev:local                # syncs .env → .dev.vars, then wrangler dev --local
```

`pnpm dev:local` runs `scripts/sync-dev-vars.mjs` to copy `.env` into `.dev.vars`
(wrangler's local vars file) before starting the local worker. `.dev.vars` is
gitignored.

`pnpm dev` runs `wrangler dev --remote` — it uses your real Cloudflare bindings
(D1, KV, Durable Objects, Workers AI). Use this when you need live state; use
`dev:local` for offline iteration.

## Provider keys

Models auto-activate when their provider key is present in the environment. Missing
keys simply exclude that provider's models from routing — no error.

| Provider | Env var | Notes |
| --- | --- | --- |
| Workers AI | `CLOUDFLARE_WORKERS_AI_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` | Uses CF AI binding in prod; REST fallback for local |
| Groq | `GROQ_API_KEY` | |
| Gemini | `GEMINI_API_KEY` | |
| OpenRouter | `OPENROUTER_API_KEY` | |
| Cerebras | `CEREBRAS_API_KEY` | |
| SambaNova | `SAMBANOVA_API_KEY` | |
| NVIDIA NIM | `NVIDIA_API_KEY` | |
| Voyage | `VOYAGE_API_KEY` | embeddings only |

Never commit real keys. `.env`, `.dev.vars`, and `ops/gateway-key-hashes.local.json`
are gitignored. The pre-push hook scans tracked files for known secret patterns.

## Gateway auth in local dev

`GATEWAY_API_KEY` can be omitted or left blank in local dev where the worker is not
publicly reachable. Token-spending routes will accept an empty bearer locally. In
production, all mutation `/v1/*` routes fail closed with `401` when the key is
missing or invalid.

## Useful endpoints while developing

- `GET /health` — model health snapshots (browser → HTML dashboard, API → JSON)
- `GET /v1/routing/status` — live fallback order with latency/headroom/cooldown
- `GET /v1/models` — searchable model catalog (browser HTML / API JSON)
- `GET /docs` — Swagger UI from the auto-generated OpenAPI spec
- `GET /dashboard` — operator dashboard

## Playground SPA

`playground/` is a Vite + React 19 demo SPA. Build with `pnpm build:playground`.
Served via the `ASSETS` binding in production; disabled by default
(`PLAYGROUND_ENABLED=false`).

## tsconfig notes

The tsconfig was previously broken (no `include`, no workers types,
`noPropertyAccessFromIndexSignature` conflict with Hono internals). Fixed
2026-04-25. `e2e-live/` tests are excluded from the main tsconfig because they need
`@types/node` which conflicts with `@cloudflare/workers-types` globals. If you add
Node-only tooling, keep it out of the main typecheck path.
