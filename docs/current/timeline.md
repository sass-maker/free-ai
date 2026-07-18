# Timeline

Historical milestones. For current state see [`../../STATUS.md`](../../STATUS.md).
Append new dated entries at the bottom; do not rewrite history.

- **2026-04-25** — `tsconfig` fixed (added `include`, `@cloudflare/workers-types`,
  resolved `noPropertyAccessFromIndexSignature` conflict). `model=auto` vision
  routing verified working.
- **2026-04-27** — `NeuronBudgetDO` introduced (commit `5c4aef1`), 9,500/day cap
  with 500-unit buffer below the 10,000 free allocation.
- **2026-05-09** — Cloudflare cost guardrails committed; `pnpm audit:cloudflare-costs`
  gates deploys.
- **2026-05-25** — Public landing + "Get API key" CTA + quickstart shipped.
- **2026-05-26** — Provider status proof, fallback explanation, rate-limit
  expectations, curl-to-SDK bridge, saved-cost proof strip all shipped to landing.
- **2026-05-27** — Explicit "Get API Key" CTA restored to hero + nav.
- **2026-05-28** — Free compute source audit completed; Hugging Face router
  rejected as production routing backend.
- **2026-06-03** — Live smoke verified: `model: "auto"` → `mistral-small-latest`;
  `/v1/budget` 2 used / 9,498 remaining; OpenRouter reported exhausted.
- **2026-06-06** — Project recommendation context generated for Starboard.
- **2026-06-21** — `/v1/models` now includes `type: "embedding"` rows for Gemini,
  Voyage, and Workers AI embeddings with dimensions, aliases, and `enabled`
  availability.
- **2026-06-22** — Local embedding catalog rollout ready; `pnpm check` passes
  (cost audit, typecheck, 18 Vitest files / 108 tests).
- **2026-06-28** — Embedding catalog deployed to production (sha `cfd0452`). Smoke
  confirmed: `embedding_model_count: 6`, `gemini-embedding-001` live with
  dimensions + aliases. Downstream RAG consumers can use the catalog.
- **2026-07-17** — Blume docs setup added (`docs-blume/`) for the public API
  reference; agent indexing surfaces (llms.txt, llms-full, /api/ai, robots, edge)
  shipped.
- **2026-07-18** — Repository knowledge system consolidated: `docs/` reorganized
  into product/architecture/development/operations/knowledge/current; `STATUS.md`
  replaces `PROJECT_STATUS.md`; Blume repurposed to render the `docs/` tree.
