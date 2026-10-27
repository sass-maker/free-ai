#!/usr/bin/env node

import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'docs-blume/dist');
const destination = resolve(root, 'site/dist/docs');

// Astro creates a fresh dist before this merge; never erase an existing tree.
await access(destination).then(
  () => {
    throw new Error('Docs destination already exists; run the site build first.');
  },
  () => {}
);
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Merged Blume output into ${destination}`);

await import('../site/scripts/finalize-markdown.mjs');
