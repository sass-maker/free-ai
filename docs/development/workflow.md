# Contribution Workflow

## Linting and formatting

Biome is the sole linter/formatter (migrated from ESLint in commit `392283a`).

```bash
pnpm lint           # biome check . (read-only)
pnpm lint:fix       # biome check . --write --unsafe
pnpm format         # biome format . --write
pnpm format:check   # biome format . (read-only)
```

Biome config lives in `biome.json`. The `site/` Astro files are excluded from
Biome's TS rules (Astro frontmatter consts get mangled); format-only applies.

## Before pushing

1. `pnpm check` — runs cost audit + typecheck + unit tests.
2. `pnpm lint` — Biome check.
3. `pnpm docs:check` — validate docs links + Blume build (if docs changed).
4. The pre-push hook runs lint + secret scan automatically.

## Commit style

Recent commits use lowercase imperative summaries (`Add ...`, `Fix ...`,
`chore: ...`, `feat: ...`, `docs: ...`). Match the surrounding style. Keep diffs
small and reviewable.

## Fleet standard

This repo follows the shared fleet agent standard at `../AGENTS.md` (fleet root).
Treat this as owned product code: protect production stability, keep changes scoped,
verify work, and record durable follow-up tasks when something remains incomplete.

## Free AI first

Prefer free/local AI paths for routine development and analysis: this gateway, local
models, provider free tiers, and cached context. Escalate to paid models only when
complexity, correctness risk, or missing capability justifies the cost. Note any
paid-AI use in the task or handoff when it materially affects cost, reproducibility,
or future maintenance.

## SaaS Maker as system of record

Treat SaaS Maker as the system of record for project metadata, feedback, tasks,
analytics, testimonials, changelog, and fleet visibility. Prefer API-first workflows
(`fnd api`, the SDK, or widgets) over one-off scripts. Mirror durable next steps
discovered locally back into SaaS Maker before handoff.
