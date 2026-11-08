import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env');
const DEV_VARS_PATH = resolve(process.cwd(), '.dev.vars');

const ALLOWED_KEYS = [
  'GATEWAY_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'VOYAGE_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_WORKERS_AI_API_KEY',
  'PLAYGROUND_ENABLED',
  'ENABLE_PHASE2',
  'AUTO_ISSUE_KEYS',
];

function parseEnv(contents) {
  const env = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function main() {
  let env;
  try {
    const raw = readFileSync(ENV_PATH, 'utf8');
    env = parseEnv(raw);
  } catch {
    console.error('Missing .env file. Create one from .env.example first.');
    process.exit(1);
  }

  const lines = [];
  for (const key of ALLOWED_KEYS) {
    const value = process.env[key] ?? env[key];
    if (value === undefined || value === '') {
      continue;
    }

    lines.push(`${key}=${value}`);
  }

  writeFileSync(DEV_VARS_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Synced ${lines.length} keys to .dev.vars`);
}

main();
