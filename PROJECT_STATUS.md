# free-ai — PROJECT STATUS

Last updated: 2026-08-31

## Why / What

The gateway remains live as a retiring compatibility service while Fleet moves
to project-owned free-provider and local endpoints. The caller migration is
complete in the current Fleet audit, but no gateway deploy, DNS change, secret
mutation, provider-resource deletion, or data deletion is authorized.

See [`docs/current/objective.md`](docs/current/objective.md) for scope guardrails.

## Dependencies

- Cloudflare Workers, Workers AI, KV, and the provider free tiers routed by the
  gateway.
- Fleet consumers use the public gateway contract; architecture details live
  in [`docs/architecture/overview.md`](docs/architecture/overview.md).
- Ultracite 7.10.2 is an exact development-only Biome preset dependency. Local
  exceptions preserve Free AI's established gateway and documentation style;
  it does not affect runtime routing or provider behavior.

## Timeline

- **2026-08-31** — Prepared a staged gateway decommission runbook with separate
  approval gates for traffic and domain removal, secret and provider credential
  revocation, compute deletion, and retained-data deletion. The gateway remains
  live until every prerequisite and explicit approval is recorded; no production
  action ran.
- **2026-08-09** — Adopted the verified Ultracite-backed Biome baseline through
  the existing read-only lint gate, with explicit compatibility exceptions and
  no source rewrite, production dependency, routing, cost-cap, or deployment
  change.
- **2026-07-31** — Tightened the public homepage description to a
  search-result-safe length and verified the Astro build; production deployment
  remains separate.
- **2026-07-29** — Added the first-party public `/changelog` route, sourced
  from verified milestones in `docs/current/timeline.md`. Planned work remains
  in GitHub Issues and Source points to the canonical organization repository.
The shipped timeline lives in
[`docs/current/timeline.md`](docs/current/timeline.md).

## Products

- **Deploy:** manual via `cloudflare-deploy.yml` workflow_dispatch (not auto-on-push).
- **Cost guard:** `pnpm audit:cloudflare-costs` gates deploys; Workers AI capped at
  9,500 neurons/day.
- **Live URL:** `https://ai-gateway.sassmaker.com`.

## Features (shipped)

- **Full feature list:** [`docs/product/features.md`](docs/product/features.md).
- **Architecture:** [`docs/architecture/overview.md`](docs/architecture/overview.md).
- **Quality gate:** exact Ultracite-backed Biome presets with explicit local
  compatibility exceptions; `pnpm lint` remains non-writing.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sass-maker/free-ai/issues).
An open issue is a to-do, a linked pull request is in progress, and merge plus
issue closure makes the work done.
