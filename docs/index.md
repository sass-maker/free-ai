# free-ai — Repository Knowledge

Local-first documentation for the AI Gateway. Markdown here is the source of truth;
Blume (in `docs-blume/`) is only the presentation/search layer. Code and executable
configuration remain authoritative for implementation details and schedules.

## Navigation

| Area | Path | What lives there |
| --- | --- | --- |
| Current state | [`STATUS.md`](../STATUS.md) + [`current/`](current/) | Live objective, blockers, timeline |
| Product | [`product/`](product/) | What the gateway is, model/provider landscape, credit guides |
| Architecture | [`architecture/`](architecture/) | System design, request flow, ADRs |
| Development | [`development/`](development/) | Local dev, testing, contribution workflow |
| Operations | [`operations/`](operations/) | Deploy, cost guardrails, key ops, CI jobs, runbooks |
| Knowledge | [`knowledge/`](knowledge/) | Durable learnings, concept stubs, failed approaches |
| Marketing | [`marketing/`](marketing/) | Event map, UTM plan, one-liners, weekly report template |
| Public API reference | [`../site/src/content/docs/`](../site/src/content/docs/) | User-facing API docs rendered by the Starlight site |

## Documentation maintenance rules

1. **One canonical home per fact.** If a fact appears in two places, pick one and link
   from the other. Do not duplicate.
2. **Markdown is the source of truth.** Blume, the Starlight site, and any other
   renderer are presentation layers — never edit generated copies.
3. **Code is authoritative for implementation.** Don't restate what is easily
   discoverable from code (function signatures, config values, model tables that
   already live in `src/config.ts`). Document *why*, not *what*.
4. **Mark unknowns.** Use `TBD` or an explicit "Unresolved" section rather than
   inventing rationale.
5. **Preserve history.** Prefer `git mv` over delete-and-create when consolidating.
   Archive retired docs under `knowledge/failed-approaches/` rather than deleting.
6. **Keep pages focused.** Target 150–300 lines per file. Split catch-all pages into
   per-topic pages.
7. **Validate before commit.** Run `pnpm docs:check` to catch broken links and
   orphaned pages. CI runs the same check on every push.

## Where things live (quick map)

- `AGENTS.md` — concise agent bootloader (purpose, commands, constraints, doc nav)
- `STATUS.md` — short current-state snapshot (objective, active work, blockers)
- `README.md` — public-facing product overview + quickstart (user-facing)
- `docs/` — this knowledge tree (maintainer/agent-facing)
- `site/src/content/docs/` — public API reference rendered by Starlight
- `docs-blume/` — Blume presentation layer for this `docs/` tree
- `src/` — gateway implementation (authoritative for code behavior)
