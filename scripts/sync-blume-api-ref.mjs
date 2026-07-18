#!/usr/bin/env node
// Sync the public API reference from site/src/content/docs/ into
// docs-blume/docs/ with Starlight-specific component syntax stripped so Blume
// can render the MDX as plain markdown.
//
// The source of truth is site/src/content/docs/. docs-blume/docs/ is a GENERATED
// copy — it is gitignored and must not be edited directly.
//
// Usage: node scripts/sync-blume-api-ref.mjs
//
// What it does:
//   - Reads every .mdx file in site/src/content/docs/
//   - Strips `import { Tabs, TabItem } from '@astrojs/starlight/components';`
//   - Converts <Tabs><TabItem label="X">...</TabItem></Tabs> into #### X headers
//   - Writes the result to docs-blume/docs/<same-name>.mdx
//   - Preserves frontmatter (title, description)

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'site/src/content/docs');
const DEST = join(ROOT, 'docs-blume/docs');

function stripStarlight(content) {
  let out = content;
  // Remove the starlight components import line
  out = out.replace(
    /^import\s*\{[^}]*\}\s*from\s*'@astrojs\/starlight\/components';\s*\n/m,
    '',
  );
  // Convert <Tabs> ... </Tabs> blocks into #### headers
  // <TabItem label="curl"> ... </TabItem>  →  #### curl\n ...
  out = out.replace(/<Tabs>\s*\n/g, '');
  out = out.replace(/\s*<\/Tabs>\s*\n/g, '\n');
  out = out.replace(/<TabItem\s+label="([^"]+)">\s*\n/g, (_, label) => `\n#### ${label}\n\n`);
  out = out.replace(/\s*<\/TabItem>\s*\n/g, '\n');
  return out;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    process.exit(1);
  }
  await mkdir(DEST, { recursive: true });
  const files = await walk(SRC);
  let count = 0;
  for (const file of files) {
    const rel = relative(SRC, file);
    const outPath = join(DEST, rel);
    await mkdir(dirname(outPath), { recursive: true });
    const content = await readFile(file, 'utf8');
    const stripped = stripStarlight(content);
    await writeFile(outPath, stripped);
    count += 1;
    console.log(`  synced: ${rel}`);
  }
  console.log(`\nDone. ${count} files synced to docs-blume/docs/`);
  console.log('This directory is gitignored — do not commit generated copies.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
