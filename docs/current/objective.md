# Current Objective

The gateway remains live only as a retiring compatibility service. The current
Fleet audit found no remaining gateway callers; active work is staged retirement
with explicit approval before traffic, credential, compute, or retained-data
changes. No production action is authorized by this document.

**Scope guardrails:**
- **IN scope:** keep the compatibility service safe while retirement gates are
  reviewed; preserve cost guardrails and document the decommission sequence.
- **OUT of scope:** new gateway features, public self-serve key issuance,
  unapproved DNS or traffic changes, credential revocation, resource deletion,
  and retained-data deletion.

See [`../operations/decommission.md`](../operations/decommission.md) for the
staged retirement gates and [`../../STATUS.md`](../../STATUS.md) for repository
status.
