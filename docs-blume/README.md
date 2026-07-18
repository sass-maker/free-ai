# AI Gateway knowledge docs (Blume)

Blume is the **presentation and search layer** for the repository knowledge tree in
`../docs/`. The committed Markdown in `../docs/` is the source of truth — never edit
generated Blume output (`dist/`, `.blume/`).

## What lives here

- `blume.config.ts` — Blume configuration. `content.root` points at `../docs`.
- `package.json` — Blume + Astro deps for the presentation build.

Generated artifacts (gitignored, never committed):
- `dist/` — Blume build output.
- `.blume/` — Blume's generated Astro project.
- `.astro/` — Astro cache.
- `node_modules/` — deps.
- `docs/` — (only present if `scripts/sync-blume-api-ref.mjs` is run; see below).

## Build

```bash
npm install
npm run build      # blume build → dist/
npm run dev        # blume dev → local preview
npm run doctor     # blume doctor (config sanity)
```

This package uses npm (not pnpm) because Blume's generated project expects a
flat `node_modules`. The root repo uses pnpm; the two are independent.

## Relationship to the public API reference

The **public API reference** (user-facing) lives in `../site/src/content/docs/` and
is rendered by the Starlight site served at `ai-gateway.sassmaker.com`. Blume here
renders the **maintainer/agent knowledge tree** (`../docs/`). These are different
documents for different audiences — they are not duplicated content.

If you later want Blume to also render the public API reference, run
`node scripts/sync-blume-api-ref.mjs` to generate a stripped copy into
`docs-blume/docs/` and add a second Blume instance or content root. The sync script
strips Starlight-specific component imports (`Tabs`/`TabItem`) and converts them to
plain `#### ` headers so Blume can render them.
