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

## `check-models.yml` — Model registry drift

- **Schedule:** `0 9 * * 0` (every Sunday 09:00 UTC).
- **Trigger:** schedule + `workflow_dispatch`.
- **Permissions:** `contents: write`, `pull-requests: write`.
- **Steps:**
  1. `node scripts/check-model-ids.mjs --json` against live provider APIs
     (Groq, OpenRouter, Cerebras, Gemini).
  2. If `stale + new > 0`: run `--patch` to update `src/config.ts`, create a
     branch `chore/model-sync-<timestamp>`, commit, push, open a PR.
  3. New models get conservative defaults (`priority: 0.50`, `reasoning: medium`,
     `toolCalling: false`, `vision: false`, `contextWindow: 32768`) — review and
     tune before merge.
- **Secrets required:** `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`,
  `GEMINI_API_KEY`, `GITHUB_TOKEN`.

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
4. If the job opens PRs, set `permissions: { contents: write, pull-requests: write }`.
