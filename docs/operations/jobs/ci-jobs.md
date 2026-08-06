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
  (cost audit + Starlight build + `wrangler deploy`) → smoke `curl /health`.
- **Permissions:** `contents: read`.

## `weekly.yml` — Weekly quality check

- **Schedule:** `0 9 * * 1` (every Monday 09:00 UTC).
- **Trigger:** schedule + `workflow_dispatch`.
- **Steps:** runs `lint`, `typecheck`, `test`, `build` if the script exists in
  `package.json`. Tolerates pnpm/npm/yarn lockfiles.
- **Purpose:** catches drift / rot on a cadence without blocking deploys.

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

## `provider-health.yml` — Daily no-spend provider health

- **Schedule:** `20 4 * * *` (every day at 04:20 UTC).
- **Trigger:** schedule + `workflow_dispatch`.
- **Permissions:** `contents: read`, `issues: write`.
- **Steps:** runs `pnpm check:provider-health` logic against public
  `/v1/routing/status`, `/v1/provider-quotas`, and `/v1/analytics?days=7`.
  Reports response freshness, fallback readiness, model availability, exhausted
  providers, seven-day/day-level failure evidence, and successful-request
  concentration by provider.
- **Failure thresholds:** stale or invalid routing evidence, fewer than two
  routable models, fallback readiness false, endpoint failure, or a seven-day
  failure rate over 20% once at least 20 requests exist.
- **Concentration warning:** reports (without failing solely for it) when one
  provider supplies more than 85% of at least 100 attributed successes. This
  avoids shifting traffic from a healthy provider to a degraded one merely to
  improve distribution.
- **Issue lifecycle:** maintains `[provider-health] Live gateway degradation`
  while unhealthy and closes it on recovery.
- **Spend:** no provider secret is supplied and no token-spending route is used.

## `provider-landscape.yml` — Monthly provider review

- **Schedule:** `40 8 1 * *` (first day of each UTC month at 08:40 UTC).
- **Trigger:** schedule + `workflow_dispatch`.
- **Permissions:** `contents: read`, `issues: write`.
- Creates at most one `[provider-landscape] YYYY-MM review` issue per UTC month
  with official candidate sources and an activation checklist. It does not
  change the registry or approve spend/deployment.

## `docs-check.yml` — Documentation validation

- **Trigger:** push to `main`, PR to `main`.
- **Steps:** `pnpm docs:check` (broken-link scan + orphan detection) +
  `pnpm docs:build` (Blume build smoke).
- See [`../development/workflow.md`](../../development/workflow.md) for local
  equivalents.

## Adding a new scheduled job

1. Create `.github/workflows/<name>.yml`.
2. Use `cron` syntax in UTC. Document the schedule here.
3. Prefer `workflow_dispatch` alongside `schedule` so it can be triggered manually.
4. Grant only the mutation permission the job needs. Recurring provider jobs
   use `issues: write`; deployment remains manual.
