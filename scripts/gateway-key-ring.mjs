#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_MANIFEST = 'ops/gateway-key-hashes.local.json';
const SECRET_NAME = 'GATEWAY_API_KEY_HASHES';

function usage() {
  console.log(`Gateway key ring helper

Usage:
  node scripts/gateway-key-ring.mjs generate --label <label> [--manifest <path>]
  node scripts/gateway-key-ring.mjs add-hash --label <label> --sha256 <hash> [--manifest <path>]
  node scripts/gateway-key-ring.mjs list [--manifest <path>]
  node scripts/gateway-key-ring.mjs print-secret [--manifest <path>]
  node scripts/gateway-key-ring.mjs upload [--manifest <path>]

Notes:
  - The manifest stores labels and SHA-256 hashes only, never plaintext keys.
  - generate prints the plaintext key once. Store it immediately.
  - upload replaces the complete ${SECRET_NAME} Worker secret with the manifest contents.
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, manifest: DEFAULT_MANIFEST };

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected argument: ${item}`);
    }

    const key = item.slice(2).replaceAll('-', '_');
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${item}`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(value);
}

function normalizeLabel(label) {
  const normalized = label.trim();
  if (!/^[a-zA-Z0-9._:-]{1,64}$/.test(normalized)) {
    throw new Error('Label must be 1-64 chars: letters, numbers, dot, underscore, colon, or dash');
  }
  return normalized;
}

function loadManifest(path) {
  if (!existsSync(path)) {
    return { version: 1, updated_at: null, entries: [] };
  }

  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(manifest.entries)) {
    throw new Error(`${path} is not a gateway key-ring manifest`);
  }

  return {
    version: 1,
    updated_at: manifest.updated_at ?? null,
    entries: manifest.entries,
  };
}

function saveManifest(path, manifest) {
  const withTimestamp = {
    ...manifest,
    updated_at: new Date().toISOString(),
    entries: manifest.entries.sort((a, b) => a.label.localeCompare(b.label)),
  };
  writeFileSync(path, `${JSON.stringify(withTimestamp, null, 2)}\n`, { mode: 0o600 });
}

function entryLines(manifest) {
  return manifest.entries.map((entry) => `${entry.label}:${entry.sha256}`);
}

function upsertEntry(manifest, entry) {
  const labelIndex = manifest.entries.findIndex((item) => item.label === entry.label);
  if (labelIndex !== -1) {
    throw new Error(`Label already exists: ${entry.label}`);
  }

  if (manifest.entries.some((item) => item.sha256 === entry.sha256)) {
    throw new Error(`Hash already exists in manifest: ${entry.sha256}`);
  }

  manifest.entries.push(entry);
}

function generateKey() {
  return `fai_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uploadSecret(secretValue) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'secret', 'put', SECRET_NAME], {
    input: secretValue,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`wrangler secret put failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function cmdGenerate(args, manifestPath, manifest) {
  const label = normalizeLabel(args.label ?? '');
  const key = generateKey();
  const entry = {
    label,
    sha256: sha256Hex(key),
    created_at: new Date().toISOString(),
  };
  upsertEntry(manifest, entry);
  saveManifest(manifestPath, manifest);
  console.log(`key=${key}`);
  console.log(`sha256=${entry.sha256}`);
  console.log(`manifest=${manifestPath}`);
  console.log('Upload with: pnpm keys:upload');
}

function cmdAddHash(args, manifestPath, manifest) {
  const label = normalizeLabel(args.label ?? '');
  const sha256 = String(args.sha256 ?? '').toLowerCase();
  if (!isSha256(sha256)) {
    throw new Error('--sha256 must be a 64-character SHA-256 hex digest');
  }
  upsertEntry(manifest, { label, sha256, created_at: new Date().toISOString() });
  saveManifest(manifestPath, manifest);
  console.log(`added=${label}`);
  console.log(`manifest=${manifestPath}`);
}

function cmdList(manifest) {
  for (const line of entryLines(manifest)) {
    console.log(line);
  }
}

function cmdPrintSecret(manifest) {
  console.log(entryLines(manifest).join('\n'));
}

function cmdUpload(manifest, manifestPath) {
  const secretValue = entryLines(manifest).join('\n');
  if (!secretValue) {
    throw new Error(`No entries in ${manifestPath}`);
  }
  uploadSecret(secretValue);
}

const COMMANDS = {
  generate: cmdGenerate,
  'add-hash': cmdAddHash,
  list: (_args, _manifestPath, manifest) => cmdList(manifest),
  'print-secret': (_args, _manifestPath, manifest) => cmdPrintSecret(manifest),
  upload: (_args, manifestPath, manifest) => cmdUpload(manifest, manifestPath),
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(process.cwd(), args.manifest);
  const manifest = loadManifest(manifestPath);

  if (!args.command || args.command === 'help' || args.command === '--help') {
    usage();
    return;
  }

  const handler = COMMANDS[args.command];
  if (handler) {
    handler(args, manifestPath, manifest);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
