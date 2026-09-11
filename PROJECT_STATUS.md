# free-ai — PROJECT STATUS

Last updated: 2026-09-12

## Why / What

The owner’s September 7 direction is to keep the gateway active for now.
The August 31 retirement assessment below is historical, not current authority.
Read-only public analytics on September 7 reports September 6–7 traffic
attributed to AI Game and High Signal, so the earlier claim of no remaining
callers is contradicted by current telemetry. This does not prove individual
client deployments or a fresh protected inference request. Production maintenance
now has owner approval and uses the existing manual deployment workflow. Provider
expansion and decommission are outside the current repair.

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

- **2026-09-12** — Chat attempts now disable the SDK's hidden retries so the
  gateway owns fallback and its existing two-attempt budget. The installed SDK's
  `Request timed out.` error is recognized as retriable; user cancellation still
  stops. Real-SDK regression tests cover streaming/nonstreaming request counts
  and timeout recovery through the gateway to a different model. All 277 tests,
  the full quality gate and documentation checks pass locally. Live sustained
  reliability and consuming-product qualification remain tracked in issue 65.

- **2026-09-12** — The public home, FAQ and changelog use one accessible
  repository-icon component with a 44px target. Source links no longer display
  a text label. Gateway authentication, routing and provider behavior are unchanged.

- **2026-09-11** — Fixed the health dashboard's mobile grid overflow. With live
  routing data, its fallback table stretched a 390px document to 1082px; health
  cards now shrink within the grid and preserve the table's own horizontal
  scrolling. Local browser verification keeps the populated page at 390px,
  and the 18 operator-route tests and full 273-test quality gate pass.
  Physical iPhone acceptance remains separate.

- **2026-09-11** — Released repair for upstream account failures: live replay found
  SambaNova returning 402 and ZAI returning 401. Automatic chat previously stopped
  at those failures even with another eligible provider. It now skips the failed
  provider's remaining models and tries another selected provider within the
  existing two-attempt limit. Explicit provider restrictions, gateway authentication,
  safety refusals, generic 403 rejection, capability filters and cost caps remain
  intact. Regression tests reproduced the prior 502 and now pass; the full local
  quality gate passes all 273 tests. Source `d94267b` passed CI 34534016426 and
  deployment 34534132478; its Worker version serves 100% of traffic. Fresh low,
  medium and high reasoning JSON requests all returned 200 with the expected
  object; anonymous inference remained 401. Sustained reliability and current
  consuming-product qualification remain open under issue 65.

- **2026-09-09** — Released degraded-routing repair in source bcb190a9: live routing ranked a
  zero-success preferred-tier model before an external model with 74% success.
  Both fell into the same poor-reliability bucket, where tier preference masked
  the existing health score. That bucket now ranks by health score first;
  minimum capabilities, explicit overrides, cooldowns, quotas and Workers AI
  fallback position are preserved. The reproduced regression fails before the
  repair and passes after it. High Signal replay 34381655339 recorded one HTTP
  429 and three HTTP 502 comparison failures, each after two attempts. This
  ranking repair is live at 100% traffic after manual deploy 34382941138 passed.
  The public routing order now leads with Mistral rather than zero-success
  preferred-tier models. Consumer replay 34383136925 is running; recovery
  remains unverified under #65.
  [Release receipt](docs/operations/2026-09-09-degraded-routing-release.json).

- **2026-09-09** — Released in source f4aa1bef: High Signal replay 34374070475 reported
  upstream 404 wrapped as invalid input. The gateway classified missing upstream
  models as caller errors and stopped before fallback. Chat now advances to the
  next selected candidate for a missing upstream model, within the existing
  two-attempt cap. Exhaustion reports provider failure (502); invalid inputs and
  safety refusals still stop immediately. All 264 tests and `pnpm check` pass.
  Manual deploy 34375302646 passed health smoke; source tag and 100% traffic
  verified. High Signal replay 34375574748 is running. Live consumer recovery
  remains unverified under #65.
  [Release receipt](docs/operations/2026-09-09-missing-model-release.json).

- **2026-09-09** — Reproduced a second routing defect through the real request
  handler: a nonzero round-robin offset promoted a zero-success model, and could
  even promote fallback-only Workers AI ahead of healthy external providers.
  Rotation now applies only to the leading healthy external peers in the same
  reasoning tier. Existing fallback order, capability filters, retries and quotas
  remain intact. High Signal's bounded retry returned HTTP 502 twice and
  published nothing; local routing tests do not establish recovered inference.
  Release and consumer acceptance remain in #65.


- **2026-09-08** — Reproduced and repaired automatic routing that preferred a
  zero-success medium-tier model over high-success models with recent latency
  or retriable-failure degradation. Low observed success now ranks separately
  below temporary degradation. Explicit overrides and the Workers AI fallback
  position remain intact. Live request-failure reduction and authorized inference
  remain tracked in [#65](https://github.com/sass-maker/free-ai/issues/65).

- **2026-09-07** — Corrected guest access CTAs to operator-provisioned access
  requirements and fixed top-level `project_id` in homepage/getting-started
  and JavaScript chat examples. A test executes the documented JavaScript
  request through the real OpenAI SDK, Hono auth/router and provider adapter
  with synthetic upstream HTTP; unauthenticated and unavailable-provider
  boundaries are also tested. Built landing-to-authentication navigation
  passes in isolated Chrome. These are local proofs, not live inference.

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
