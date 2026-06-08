# Project Recommendation Context

Generated: 2026-06-06T21:14:19.554Z

This file is a CodeVetter Repo Unpacked-inspired audit written for Starboard recommendations. It is intentionally local, evidence-oriented, and safe to commit: it records product context, feature areas, stack inventory, and recommendation guidance without secrets or environment values.

## Project Identity

- Slug: `free-ai`
- Registry description: OpenAI-compatible AI gateway that connects multiple free model providers and exposes them through one API.
- Product grouping: `internal-first`
- Source path: `free-ai`

## Product Context

OpenAI-compatible AI gateway that connects multiple free model providers and exposes them through one API.

Free AI Gateway is an OpenAI-compatible Cloudflare Worker gateway that routes authenticated project-scoped requests across configured free-tier AI providers with health-aware model selection, capability filtering, aggregate analytics, and operator-facing health surfaces.

Free AI Gateway OpenAI-compatible API gateway that routes requests across free LLM providers with health-aware model selection, capability-based filtering, and aggregated analytics. Powered by SaaS Maker https://sassmaker.com . Deployment & External Services Concern Service --------- --------- Hosting Cloudflare Workers free-ai-gateway — deployed via wrangler deploy Database Cloudflare D1 free-ai-gateway-db — anonymous aggregate analytics State / Caching Cloudflare Durable Objects HealthStateDO , IpRateLimitDO , NeuronBudgetDO ; Cloudflare KV HEALTH KV Marketing / docs site Astro + Starlight site/ , built into site/dist and served by the Worker via the ASSETS binding — no separate deploy AI 

## Feature Map

- **Cloudflare and deploy**: Workers, Pages, edge runtime, queues, storage, and deploy automation. Keywords: cloudflare, worker, workers, pages, edge, deploy, wrangler, queue.
- **AI agents**: Agents, tool use, workflows, orchestration, RAG, evals, and model integration. Keywords: ai, agent, agents, llm, rag, embedding, eval, model.
- **UI workflows**: Dashboards, tables, forms, component systems, charts, and user workflows. Keywords: ui, ux, dashboard, table, component, react, next, tailwind.
- **Testing and quality**: Unit tests, browser tests, evals, CI quality gates, and regression checks. Keywords: test, testing, quality, vitest, playwright, ci, eval, benchmark.
- **Search and discovery**: Search, ranking, recommendations, feeds, semantic retrieval, and discovery UX. Keywords: search, discovery, recommend, ranking, semantic, feed, index, retrieval.
- **Analytics and intelligence**: Signal analysis, forecasting, monitoring, trends, metrics, and decision support. Keywords: analytics, intelligence, signal, forecast, monitoring, metric, trend, insight.
- **Content and media**: Content production, video, reels, documents, markdown, and publishing workflows. Keywords: content, media, video, reel, markdown, document, publish, editor.

## Runtime Surfaces and Entrypoints

- `src/index.ts`

## Current Stack

- Languages: `Astro`, `Python`, `TypeScript`
- Frameworks/tools: `Astro`, `Cloudflare Workers`, `Playwright`, `React`, `Vitest`
- Config files:
- `playground/tailwind.config.js`
- `playground/vite.config.ts`
- `playwright.config.ts`
- `site/astro.config.mjs`
- `vitest.config.ts`
- `wrangler.toml`

## OSS Already In Use

Direct dependencies:
- `@astrojs/starlight`
- `@hono/swagger-ui`
- `@hono/zod-openapi`
- `@hookform/resolvers`
- `@saas-maker/ops`
- `@tanstack/react-query`
- `astro`
- `hono`
- `openai`
- `p-limit`
- `p-retry`
- `react`
- `react-dom`
- `react-hook-form`
- `sharp`
- `zod`
- `zustand`

Development dependencies:
- `@cloudflare/vitest-pool-workers`
- `@cloudflare/workers-types`
- `@playwright/test`
- `@saas-maker/eslint-config`
- `@saas-maker/prettier-config`
- `@saas-maker/test-config`
- `@saas-maker/tsconfig`
- `@types/react`
- `@types/react-dom`
- `eslint`
- `husky`
- `prettier`
- `prettier-plugin-tailwindcss`
- `typescript`
- `vite`
- `vitest`
- `wrangler`

Package scripts:
- `astro`
- `audit:cloudflare-costs`
- `build`
- `build:playground`
- `check`
- `deploy`
- `deploy:cloudflare`
- `dev`
- `dev:local`
- `env:sync`
- `keys:generate`
- `keys:list`
- `keys:print-secret`
- `keys:upload`
- `lint`
- `prepare`
- `preview`
- `start`
- `test`
- `test:all`
- `test:e2e`
- `test:e2e:headed`
- `test:e2e:live`
- `test:e2e:live:update`
- `test:watch`
- `typecheck`

## Testing and Quality Signals

- `e2e-live/playground-live.spec.ts`
- `e2e/playground.test.ts`
- `playwright.config.ts`
- `test/audio-speech.spec.ts`
- `test/auth.spec.ts`
- `test/benchmark-optimizer.spec.ts`
- `test/classify-error.spec.ts`
- `test/cloudflare-cost-audit.spec.mjs`
- `test/dashboard.spec.ts`
- `test/free-tier-guard.spec.ts`
- `test/health-do.spec.ts`
- `test/helpers/env.ts`
- `test/images.spec.ts`
- `test/operator-ui.spec.ts`
- `test/provider-quota.spec.ts`
- `test/replay-lab.spec.ts`
- `test/request.spec.ts`
- `test/routing-ledger.spec.ts`
- `test/routing-status.spec.ts`
- `test/select-model.spec.ts`
- `test/stats-providers.spec.ts`
- `test/videos.spec.ts`
- `vitest.config.ts`

## Recommendation Guidance

Good matches:
- Repos that strengthen cloudflare and deploy without replacing already-installed libraries.
- Repos that strengthen ai agents without replacing already-installed libraries.
- Repos that strengthen ui workflows without replacing already-installed libraries.
- Repos that strengthen testing and quality without replacing already-installed libraries.
- Repos that strengthen search and discovery without replacing already-installed libraries.
- Repos that strengthen analytics and intelligence without replacing already-installed libraries.
- Repos that strengthen content and media without replacing already-installed libraries.
- Tools with concrete support for model, gateway, free, high, cloudflare, providers, tier, api.
- Implementation repos, SDKs, CLIs, testing utilities, adapters, and focused libraries are higher value than generic awesome lists.

Avoid recommending:
- Do not recommend packages already listed under direct or development dependencies unless the task is migration research.
- Do not recommend broad framework replacements unless the project context explicitly calls for a rewrite.
- Downrank curated lists, archived repos, stale demos, and generic UI kits that do not map to the feature catalog.

## Evidence Read

Primary docs and handoff files:
- `PROJECT_STATUS.md`
- `README.md`
- `agents.md`
- `docs/README.md`
- `docs/cheap-models-guide.md`
- `docs/cloudflare-cost-guardrails.md`
- `docs/free-ai-credits-guide.md`
- `docs/free-compute-source-audit.md`
- `docs/gateway-key-ops.md`

Package manifests:
- `examples/node-openai-sdk/package.json`
- `package.json`
- `site/package.json`

Inventory notes:
- Files scanned: 204
- This pass uses deterministic repo inventory plus local documentation/source-path evidence. It does not claim a full manual line-by-line review of every source file.

## Confidence

Confidence: **medium**

Why:
- PROJECT_STATUS.md present
- README.md present
- package dependencies inventoried
- 23 test/quality files identified

Refresh command:

```bash
cd /Users/sarthak/Desktop/fleet/starboard
pnpm fleet:audit-recommendation-context
pnpm fleet:extract-projects
```
