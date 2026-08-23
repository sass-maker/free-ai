# AI Gateway API docs (Blume)

Blume is the **presentation and search layer** for the public API reference in
`../site/src/content/docs/`. The committed Markdown there is the source of truth —
never edit generated Blume output (`dist/`, `.blume/`).

## What lives here

- `blume.config.ts` — Blume configuration. `content.root` points at the public
  API reference and `deployment.base` mounts it at `/docs`.
- `package.json` — Blume + Astro deps for the presentation build.

Generated artifacts (gitignored, never committed):
- `dist/` — Blume build output.
- `.blume/` — Blume's generated Astro project.
- `.astro/` — Astro cache.
- `node_modules/` — deps.

## Build

```bash
npm install
npm run build      # blume build → dist/
npm run dev        # blume dev → local preview
npm run doctor     # blume doctor (config sanity)
```

This package uses npm (not pnpm) because Blume's generated project expects a
flat `node_modules`. The root repo uses pnpm; the two are independent.

## Public route

The generated site is merged into the Worker asset tree at `site/dist/docs/` and
is served at `https://ai-gateway.sassmaker.com/docs/`. The main Astro site and
gateway routes remain outside this mount.
