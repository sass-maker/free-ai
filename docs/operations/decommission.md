# Gateway Decommission Runbook

**Status: prepared, not authorized for execution.** The gateway remains live at
`ai-gateway.sassmaker.com` until the owner explicitly approves each irreversible
phase below. Preparing this runbook does not authorize a deploy, DNS change,
secret mutation, provider-resource deletion, migration, or data deletion.

Fleet's ratified client standard no longer uses a shared gateway. This runbook
retires the compatibility service only after every caller has moved to a
project-owned free-provider or local endpoint and a quiet observation window
proves that no traffic still depends on it.

## Required evidence before any change

- [ ] Run SaaS Maker's `pnpm tooling:ai-clients` from the current Fleet checkout.
      The report must cover every canonical project, show no active reference to
      `ai-gateway.sassmaker.com` or gateway-only environment names, and contain
      no blocking findings.
- [ ] Reconcile service bindings, scheduled jobs, examples, documentation, and
      operator scripts that can call the gateway but may not appear as ordinary
      application source.
- [ ] Record the current Worker version and traffic allocation, custom domain,
      routes, service bindings, D1 database, KV namespace, Durable Object
      classes, Workers AI binding, and secret *names*. Never record secret
      values.
- [ ] Observe zero legitimate gateway requests for an owner-chosen quiet window.
      Record the start/end timestamps and evidence source; do not infer zero use
      from an empty application log alone.
- [ ] Decide the retention period and export destination for anonymous aggregate
      D1 data. Data deletion needs its own explicit approval.
- [ ] Confirm a rollback owner, rollback window, and last known-good Worker
      version.

If any item is missing or traffic is still present, stop. Find and migrate the
caller instead of disabling the gateway.

## Authorization record

Capture one explicit approval per phase. A broad instruction to "clean up" or
"finish migration" is not enough for destructive provider actions.

| Phase | Exact scope requiring approval | Approved by / at | Receipt |
| --- | --- | --- | --- |
| 1 | Stop new gateway releases and schedules |  |  |
| 2 | Remove application traffic, service bindings, routes, and custom domain |  |  |
| 3 | Remove Cloudflare Worker secrets and revoke provider credentials |  |  |
| 4 | Delete the Worker and unused provider-side resources |  |  |
| 5 | Delete D1, KV, Durable Object, or retained analytics data |  |  |

An approval for one row does not authorize later rows.

## Execution order

### 1. Freeze and preserve rollback

- [ ] Disable or archive manual/scheduled release paths only after Phase 1 is
      approved; keep the last production artifact and configuration receipt.
- [ ] Export the approved D1 data and verify the export can be read.
- [ ] Capture current cost and usage baselines without storing provider response
      bodies, headers, cookies, or credential material.

### 2. Drain traffic

- [ ] Remove or disable every consumer service binding and route after Phase 2
      approval.
- [ ] Re-run the Fleet client audit and consumer-owned checks.
- [ ] Observe another quiet window. Any request restarts caller investigation.
- [ ] Detach `ai-gateway.sassmaker.com` only after the quiet window passes.

Keep the Worker available by its rollback identifier during the agreed rollback
window unless the owner explicitly approves immediate deletion.

### 3. Revoke access

- [ ] After Phase 3 approval, remove Worker secret bindings by name without
      reading or printing their values.
- [ ] Revoke gateway-only provider credentials at each provider. Preserve
      credentials that are also owned by an active product; shared ownership is
      a blocker that must be resolved first.
- [ ] Verify the retired credentials can no longer authorize requests and that
      active products still pass their own provider checks.

### 4. Remove compute and provider resources

- [ ] After Phase 4 approval and expiry of the rollback window, delete the
      `free-ai-gateway` Worker and any gateway-only provider resources.
- [ ] Verify no Cloudflare route, service binding, scheduled trigger, or custom
      domain still targets the Worker.
- [ ] Confirm provider dashboards show no continuing gateway usage or spend.

### 5. Handle retained data

- [ ] Keep D1, KV, and Durable Object data for the approved retention period.
- [ ] Delete each store only after separate Phase 5 approval and a verified
      export, or record the owner's explicit decision to retain it.
- [ ] Record what was deleted, when, by whom, and whether recovery remains
      possible. Never paste stored rows or secret material into the receipt.

## Closeout

- [ ] Update Free AI's `PROJECT_STATUS.md`, public docs, repository description,
      and deploy documentation from "live" to the observed terminal state.
- [ ] Update Site Health's canonical private catalog and Free AI dossier, then
      regenerate SaaS Maker's public projection. Do not hand-edit the generated
      catalog.
- [ ] Remove the live gateway URL from public health/performance manifests only
      after the domain is intentionally offline.
- [ ] Re-run Fleet Git/CI health, the AI-client audit, public-catalog checks, and
      deploy parity.
- [ ] Attach summary-only receipts for every authorized phase and close the
      owning GitHub issue. Keep credential values and private provider output out
      of issues and repositories.

## Final receipt

Record: approved phase, actor, timestamp, affected resource category, before and
after state, verification command or dashboard view, rollback state, retained
data decision, and follow-up owner. A phase is not complete merely because its
resource disappeared; its downstream checks and receipt must also pass.
