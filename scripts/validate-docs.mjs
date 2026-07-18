#!/usr/bin/env node
// Validate the repository documentation tree.
//
// Checks:
//   1. Every relative markdown link in docs/ + root *.md resolves to a real file
//      or anchor within a real file.
//   2. Every .md file under docs/ is reachable from docs/index.md (orphan scan).
//   3. Root AGENTS.md / STATUS.md / README.md link targets resolve.
//
// Usage: node scripts/validate-docs.mjs
// Exit code: 0 if clean, 1 if any broken link or orphan is found.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCS = join(ROOT, 'docs');

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/gm;

const errors = [];
const warnings = [];

// --- helpers ---

async function walk(dir, exts = ['.md', '.mdx']) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...(await walk(full, exts)));
    } else if (exts.includes(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function slugify(heading) {
  // Match GitHub's heading slug algorithm: lowercase, strip non-word/space/hyphen,
  // then spaces → hyphens. Do NOT collapse consecutive hyphens (GitHub keeps them,
  // e.g. "ADR-002 — Scoring" → "adr-002--scoring").
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '');
}

async function collectHeadings(filePath) {
  const content = await readFile(filePath, 'utf8');
  const headings = new Set();
  let m;
  while ((m = HEADING_RE.exec(content)) !== null) {
    headings.add(slugify(m[1]));
  }
  return headings;
}

function resolveLinkTarget(fromFile, href) {
  // Strip anchor
  const [pathPart, anchor] = href.split('#');
  // Absolute URLs or mailto: — skip
  if (/^https?:\/\//.test(href) || /^mailto:/.test(href) || /^\/\//.test(href)) {
    return { external: true };
  }
  let target;
  if (pathPart.startsWith('/')) {
    target = join(ROOT, pathPart.slice(1));
  } else if (pathPart === '') {
    // Anchor-only link → same file
    target = fromFile;
  } else {
    target = resolve(dirname(fromFile), pathPart);
  }
  return { external: false, target, anchor, pathPart };
}

// --- checks ---

async function checkLinks(files) {
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    let m;
    while ((m = LINK_RE.exec(content)) !== null) {
      const href = m[2];
      const rel = relative(ROOT, file);
      const resolved = resolveLinkTarget(file, href);
      if (resolved.external) continue;

      if (!existsSync(resolved.target)) {
        errors.push(`broken link: ${rel} → ${href} (target not found)`);
        continue;
      }
      if (resolved.anchor) {
        const statRes = await stat(resolved.target);
        if (statRes.isDirectory()) continue;
        if (extname(resolved.target) === '.md' || extname(resolved.target) === '.mdx') {
          const headings = await collectHeadings(resolved.target);
          if (!headings.has(resolved.anchor)) {
            errors.push(
              `broken anchor: ${rel} → ${href} (heading "#${resolved.anchor}" not found in ${relative(ROOT, resolved.target)})`
            );
          }
        }
      }
    }
  }
}

async function checkOrphans(docsFiles) {
  // Build a graph: which files does each file link to?
  const linked = new Set();
  // index.md is the entry point — always reachable
  linked.add(join(DOCS, 'index.md'));

  const queue = [join(DOCS, 'index.md')];
  const visited = new Set();

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const content = await readFile(file, 'utf8');
    let m;
    while ((m = LINK_RE.exec(content)) !== null) {
      const href = m[2];
      const resolved = resolveLinkTarget(file, href);
      if (resolved.external) continue;
      if (existsSync(resolved.target)) {
        const statRes = await stat(resolved.target);
        if (statRes.isDirectory() && resolved.target.startsWith(DOCS)) {
          // A directory link makes every .md/.mdx anywhere under it reachable
          // (recurses into subdirectories).
          const nested = await walk(resolved.target);
          for (const child of nested) {
            linked.add(child);
            if (!visited.has(child)) queue.push(child);
          }
        } else if (
          !statRes.isDirectory() &&
          (extname(resolved.target) === '.md' || extname(resolved.target) === '.mdx') &&
          resolved.target.startsWith(DOCS)
        ) {
          linked.add(resolved.target);
          if (!visited.has(resolved.target)) queue.push(resolved.target);
        }
      }
    }
  }

  for (const file of docsFiles) {
    if (!linked.has(file)) {
      warnings.push(`orphan: ${relative(ROOT, file)} (not linked from docs/index.md)`);
    }
  }
}

// --- main ---

async function main() {
  const docsFiles = await walk(DOCS);
  const rootMds = ['AGENTS.md', 'STATUS.md', 'README.md']
    .map((f) => join(ROOT, f))
    .filter((f) => existsSync(f));

  const allFiles = [...docsFiles, ...rootMds];

  await checkLinks(allFiles);
  await checkOrphans(docsFiles);

  console.log(`Scanned ${docsFiles.length} docs/ files + ${rootMds.length} root markdown files.\n`);

  if (warnings.length) {
    console.log('Warnings:');
    for (const w of warnings) console.log(`  ⚠  ${w}`);
    console.log();
  }

  if (errors.length) {
    console.error('Errors:');
    for (const e of errors) console.error(`  ✖  ${e}`);
    console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }

  console.log(`✓ All links resolve. ${warnings.length} orphan warning(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
