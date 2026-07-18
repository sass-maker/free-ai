# agents.md — free-ai

Concise agent bootloader. For depth, follow the documentation navigation below.

## Purpose

OpenAI-compatible API gateway on Cloudflare Workers — routes requests across 30+
free LLM providers with health-aware model selection, capability filtering, per-IP
rate limiting, and aggregate analytics. Serves fleet projects (e.g. ai-game via
service binding) and exposes operator health/dashboard surfaces.

## Essential commands

```bash
pnpm install
cp .env.example .env          # fill provider keys
pnpm dev:local                # sync .dev.vars + wrangler dev --local
pnpm dev                      # wrangler dev --remote (live CF bindings)
pnpm check                    # cost audit + typecheck + unit tests
pnpm test                     # vitest run
pnpm test:coverage            # vitest run --coverage (enforces thresholds)
pnpm test:e2e                 # playwright (local mock)
pnpm test:e2e:live            # playwright (live gateway, local only)
pnpm typecheck                # tsc --noEmit
pnpm lint                     # biome check .
pnpm docs:check               # validate docs links + orphans
pnpm docs:build               # blume build (presentation smoke)
pnpm audit:cloudflare-costs   # pre-deploy cost guardrail
pnpm smoke:embedding-models -- --model gemini-embedding-001
pnpm keys:generate|list|print-secret|upload   # operator key ring
```

## Critical constraints

- **Do not deploy from an agent session.** Deploy is manual via the
  `cloudflare-deploy.yml` workflow_dispatch. Never run `wrangler deploy` or
  `pnpm deploy` without explicit human approval.
- **Do not commit secrets.** `.env`, `.dev.vars`, `ops/gateway-key-hashes.local.json`
  are gitignored. The pre-push hook scans tracked files for secret patterns.
- **Workers AI is fallback-only**, capped at 9,500 neurons/day. Never raise the cap
  or move Workers AI ahead of external providers in routing rank.
- **`src/index.ts` is intentionally monolithic** (~114KB / 4000+ lines). Split only
  after the route group has focused test coverage. See
  [ADR-003](docs/architecture/decisions/adr-001-007.md).
- **`project_id` is required** on all mutation `/v1/*` routes. Empty string does
  not work.
- **Fail closed on auth.** Token-spending routes return `401` when
  `GATEWAY_API_KEY` is missing/invalid. Read-only allowlist: `/v1/models`,
  `/v1/stats/providers`, `/v1/analytics`, `/v1/dashboard`, `/v1/budget`, `/health`,
  `/v1/routing/status`.
- **Free AI first.** Prefer this gateway, local models, and provider free tiers for
  routine work. Escalate to paid models only when complexity or correctness risk
  justifies the cost.

## Documentation navigation

| Need | Read |
| --- | --- |
| Current state + blockers | [`STATUS.md`](STATUS.md) |
| What the product is + features | [`docs/product/features.md`](docs/product/features.md) |
| System design + why | [`docs/architecture/overview.md`](docs/architecture/overview.md) |
| Architecture decisions (ADRs) | [`docs/architecture/decisions/adr-001-007.md`](docs/architecture/decisions/adr-001-007.md) |
| Local dev setup | [`docs/development/local-dev.md`](docs/development/local-dev.md) |
| Testing + coverage gate | [`docs/development/testing.md`](docs/development/testing.md) |
| Contribution workflow | [`docs/development/workflow.md`](docs/development/workflow.md) |
| Deploy runbook | [`docs/operations/deploy.md`](docs/operations/deploy.md) |
| Cost guardrails | [`docs/operations/cloudflare-cost-guardrails.md`](docs/operations/cloudflare-cost-guardrails.md) |
| Operator key ops | [`docs/operations/gateway-key-ops.md`](docs/operations/gateway-key-ops.md) |
| CI / scheduled jobs | [`docs/operations/jobs/ci-jobs.md`](docs/operations/jobs/ci-jobs.md) |
| Diagnostic runbook | [`docs/operations/runbooks/diagnostics.md`](docs/operations/runbooks/diagnostics.md) |
| Durable learnings + gotchas | [`docs/knowledge/learnings/lessons.md`](docs/knowledge/learnings/lessons.md) |
| Concept stubs (Cloudflare primitives) | [`docs/knowledge/learnings/concepts.md`](docs/knowledge/learnings/concepts.md) |
| Failed approaches (do not retry) | [`docs/knowledge/failed-approaches/README.md`](docs/knowledge/failed-approaches/README.md) |
| Free compute landscape | [`docs/operations/free-compute-source-audit.md`](docs/operations/free-compute-source-audit.md) |
| Cheap models guide | [`docs/product/cheap-models-guide.md`](docs/product/cheap-models-guide.md) |
| Free AI credits guide | [`docs/product/free-ai-credits-guide.md`](docs/product/free-ai-credits-guide.md) |
| Marketing | [`docs/marketing/`](docs/marketing/) |
| Timeline | [`docs/current/timeline.md`](docs/current/timeline.md) |
| Public API reference (users) | [`site/src/content/docs/`](site/src/content/docs/) |
| Docs index + maintenance rules | [`docs/index.md`](docs/index.md) |

## Documentation maintenance rules

1. **One canonical home per fact.** If a fact appears in two places, pick one and
   link from the other. See [`docs/index.md`](docs/index.md) for the full rules.
2. **Markdown in `docs/` is the source of truth.** Blume, Starlight, and any
   renderer are presentation layers — never edit generated copies.
3. **Code is authoritative for implementation.** Document *why*, not *what*. Don't
   restate what is discoverable from `src/`.
4. **Mark unknowns** with `TBD` or an "Unresolved" section. Do not invent rationale.
5. **Preserve history.** Use `git mv` over delete-and-create. Archive retired docs
   under `docs/knowledge/failed-approaches/` rather than deleting.
6. **Validate before commit.** Run `pnpm docs:check`. CI runs the same check.

## Repo structure (quick map)

```
src/                  gateway implementation (authoritative for code behavior)
  index.ts            Hono app + all route handlers (monolithic — known TODO)
  config.ts           model registry (30+ chat + 6 embedding models)
  providers/          one file per provider
  router/             select-model.ts (scoring), classify-error.ts
  state/              HealthStateDO, IpRateLimitDO, NeuronBudgetDO, client
  auth/               gateway.ts (key + hash validation)
site/                 Astro + Starlight public site (separate package.json)
site/src/content/docs/   public API reference (user-facing MDX)
docs/                 repository knowledge tree (maintainer/agent-facing)
docs-blume/           Blume presentation layer for docs/
migrations/           D1 SQL migrations (0001–0006)
scripts/              deploy, cost audit, model-id check, key ring, smoke tests
test/                 Vitest unit tests
e2e/ e2e-live/        Playwright e2e (mock + live)
examples/             Node.js + Python OpenAI SDK usage examples
ops/                  gateway key hash manifests (local json gitignored)
```

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Add durable work items in SaaS Maker Cockpit Tasks when the task affects product
  behavior, deployment, user feedback, or fleet maintenance.
- Include the project slug, a concise title, acceptance criteria, priority/status,
  and links to relevant code, issues, traces, or dashboards.
- If task discovery starts locally in an editor or agent session, mirror the
  durable next step back into SaaS Maker before handoff.

### Using SaaS Maker
- Treat SaaS Maker as the system of record for project metadata, feedback, tasks,
  analytics, testimonials, changelog, and fleet visibility.
- Prefer API-first workflows through `fnd api`, the SDK, or widgets instead of
  one-off scripts when interacting with SaaS Maker features.
- Keep this agent file aligned with the project record when operating rules,
  integrations, or deployment conventions change.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai`
  gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing
  capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost,
  reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->
