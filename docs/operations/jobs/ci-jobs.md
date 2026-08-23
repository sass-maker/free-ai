# CI / Scheduled Jobs

All workflows live in `.github/workflows/`. Schedules are defined in the workflow
files (cron) — those are authoritative, not this page.

## `ci.yml` — CI gate

- **Trigger:** push to `main`/`master`, PR to `main`/`master`.
- **Steps:** `pnpm install --frozen-lockfile` → `pnpm typecheck` →
  `pnpm test:coverage`.
- **What it guards:** TypeScript correctness + unit test coverage thresholds on
  core modules (80% lines/functions/statements, 70% branches).

## `cloudflare-deploy.yml` — Production deploy

- **Trigger:** `workflow_dispatch` only (manual). Not auto-on-push.
- **Concurrency:** `cloudflare-deploy-${{ github.ref }}`, cancels in-progress.
- **Steps:** checkout → install → typecheck → test → validate
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets → `pnpm run deploy`
  (cost audit + Astro build + Blume `/docs` build + `wrangler deploy`) → smoke
  `curl /health`.
- **Permissions:** `contents: read`.

## `check-models.yml` — Weekly provider resync

- **Schedule:** `0 9 * * 0` (every Sunday 09:00 UTC).
- **Trigger:** schedule + `workflow_dispatch`.
- **Permissions:** `contents: read`, `issues: write`.
- **Steps:**
  1. Checks every managed official catalog and records `ok`, `missing_key`, or
     `error` separately. An unavailable catalog never marks models stale.
  2. Uploads `catalog-report.json`, the optional conservative
     `model-sync.patch`, and `smoke-report.json` on every run.
  3. Runs an optional bounded `/v1/debug/replay` smoke: one enabled model per
     provider, eight output tokens maximum, and Workers AI excluded. It skips
     without making calls when `GATEWAY_API_KEY` is absent.
  4. Opens or updates `[provider-registry] Catalog drift or coverage gap` and
     fails on drift, incomplete catalog coverage, or smoke failure. A fully
     healthy run closes the issue.
- **Secrets:** one API key per authenticated provider catalog; optional
  `OPENROUTER_API_KEY`; optional `GATEWAY_API_KEY` for the bounded smoke.
- **Activation boundary:** generated candidates stay disabled. The workflow
  never commits, opens a PR, activates routing, uploads keys, or deploys.

## `docs-check.yml` — Documentation validation

- **Trigger:** push to `main`, PR to `main`.
- **Steps:** `pnpm docs:check` (broken-link scan + orphan detection) + public
  Astro build + `pnpm docs:build` (Blume `/docs` build smoke).
- See [`../development/workflow.md`](../../development/workflow.md) for local
  equivalents.

## Adding a new scheduled job

1. Create `.github/workflows/<name>.yml`.
2. Use `cron` syntax in UTC. Document the schedule here.
3. Prefer `workflow_dispatch` alongside `schedule` so it can be triggered manually.
4. Grant only the mutation permission the job needs. Recurring provider jobs
   use `issues: write`; deployment remains manual.
