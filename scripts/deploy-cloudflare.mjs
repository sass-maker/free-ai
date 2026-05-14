import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditCloudflareCostConfig } from './audit-cloudflare-costs.mjs';

const ROOT = process.cwd();
const WRANGLER_TEMPLATE = resolve(ROOT, 'wrangler.toml');
const WRANGLER_GENERATED = resolve(ROOT, '.wrangler.deploy.toml');
const ENV_PATH = resolve(ROOT, '.env');
const TMP_SECRETS_JSON = resolve(ROOT, '.deploy.secrets.json');

const DEPLOY_SECRET_KEYS = [
  'GATEWAY_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'VOYAGE_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_WORKERS_AI_API_KEY',
];

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (options.capture) {
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = `${stdout}${stderr}`;

    if (result.status !== 0) {
      throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${output}`);
    }

    return output;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }

  return '';
}

function runCaptureAllowFailure(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

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

function readEnvFile() {
  if (!existsSync(ENV_PATH)) {
    throw new Error('Missing .env file. Create it from .env.example first.');
  }

  return parseEnv(readFileSync(ENV_PATH, 'utf8'));
}

function parseWorkerName(toml) {
  const match = toml.match(/^name\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('Could not parse Worker name from wrangler.toml');
  }
  return match[1];
}

function parseHealthKvIds(toml) {
  const inline = toml.match(
    /binding\s*=\s*"HEALTH_KV"\s*,\s*id\s*=\s*"([^"]+)"\s*,\s*preview_id\s*=\s*"([^"]+)"/m,
  );

  if (inline) {
    return {
      id: inline[1],
      previewId: inline[2],
    };
  }

  const table = toml.match(
    /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"HEALTH_KV"[\s\S]*?id\s*=\s*"([^"]+)"[\s\S]*?preview_id\s*=\s*"([^"]+)"/m,
  );

  if (!table) {
    throw new Error('Could not find HEALTH_KV binding in wrangler.toml');
  }

  return {
    id: table[1],
    previewId: table[2],
  };
}

function parseIdFromCreateOutput(output) {
  const match = output.match(/id\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not parse namespace id from output:\n${output}`);
  }
  return match[1];
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function withKvIds(toml, id, previewId) {
  if (/binding\s*=\s*"HEALTH_KV"\s*,\s*id\s*=\s*"[^"]+"\s*,\s*preview_id\s*=\s*"[^"]+"/m.test(toml)) {
    return toml.replace(
      /(binding\s*=\s*"HEALTH_KV"\s*,\s*id\s*=\s*")([^"]+)("\s*,\s*preview_id\s*=\s*")([^"]+)(")/m,
      `$1${id}$3${previewId}$5`,
    );
  }

  if (/\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"HEALTH_KV"/m.test(toml)) {
    return toml.replace(
      /(\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*"HEALTH_KV"[\s\S]*?id\s*=\s*")([^"]+)("[\s\S]*?preview_id\s*=\s*")([^"]+)(")/m,
      `$1${id}$3${previewId}$5`,
    );
  }

  throw new Error('Could not replace HEALTH_KV ids in wrangler config');
}

function withVarsFromEnv(toml, env) {
  let next = toml;

  if (env.PLAYGROUND_ENABLED !== undefined) {
    next = next.replace(
      /^PLAYGROUND_ENABLED\s*=\s*"[^"]*"/m,
      `PLAYGROUND_ENABLED = "${escapeTomlString(env.PLAYGROUND_ENABLED)}"`,
    );
  }

  if (env.ENABLE_PHASE2 !== undefined) {
    next = next.replace(
      /^ENABLE_PHASE2\s*=\s*"[^"]*"/m,
      `ENABLE_PHASE2 = "${escapeTomlString(env.ENABLE_PHASE2)}"`,
    );
  }

  if (env.AUTO_ISSUE_KEYS !== undefined) {
    next = next.replace(
      /^AUTO_ISSUE_KEYS\s*=\s*"[^"]*"/m,
      `AUTO_ISSUE_KEYS = "${escapeTomlString(env.AUTO_ISSUE_KEYS)}"`,
    );
  }

  return next;
}

function parseJsonArrayFromMixedOutput(raw) {
  const start = raw.indexOf('[');
  if (start === -1) {
    return [];
  }

  let end = raw.lastIndexOf(']');
  while (end >= start) {
    const candidate = raw.slice(start, end + 1).trim();
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try an earlier closing bracket.
    }

    end = raw.lastIndexOf(']', end - 1);
  }

  return [];
}

function listNamespaces() {
  const raw = run('npx', ['wrangler', 'kv', 'namespace', 'list'], { capture: true });
  return parseJsonArrayFromMixedOutput(raw);
}

function listDatabases() {
  const raw = run('npx', ['wrangler', 'd1', 'list', '--json'], { capture: true });
  return parseJsonArrayFromMixedOutput(raw);
}

function parseD1IdFromCreateOutput(output) {
  const explicit = output.match(/database_id\s*=\s*"([^"]+)"/m);
  if (explicit) {
    return explicit[1];
  }

  const uuid = output.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (uuid) {
    return uuid[0];
  }

  throw new Error(`Could not parse D1 database id from output:\n${output}`);
}

function resolveNamespaceIds(workerName, current) {
  const idLooksPlaceholder = current.id.startsWith('replace-');
  const previewLooksPlaceholder = current.previewId.startsWith('replace-');

  if (!idLooksPlaceholder && !previewLooksPlaceholder) {
    return current;
  }

  const namespaces = listNamespaces();
  const prodTitle = `${workerName}-HEALTH_KV`;
  const previewTitle = `${workerName}-HEALTH_KV_preview`;

  let prod = namespaces.find((item) => item && item.title === prodTitle)?.id;
  let preview = namespaces.find((item) => item && item.title === previewTitle)?.id;

  if (!prod) {
    console.log('Creating KV namespace HEALTH_KV...');
    const created = runCaptureAllowFailure('npx', ['wrangler', 'kv', 'namespace', 'create', 'HEALTH_KV']);

    if (created.status === 0) {
      prod = parseIdFromCreateOutput(created.output);
    } else if (created.output.includes('already exists')) {
      const refreshed = listNamespaces();
      prod = refreshed.find((item) => item && item.title === prodTitle)?.id;
    } else {
      throw new Error(`Failed to create HEALTH_KV namespace:\\n${created.output}`);
    }
  }

  if (!preview) {
    console.log('Creating KV preview namespace HEALTH_KV...');
    const created = runCaptureAllowFailure('npx', ['wrangler', 'kv', 'namespace', 'create', 'HEALTH_KV', '--preview']);

    if (created.status === 0) {
      preview = parseIdFromCreateOutput(created.output);
    } else if (created.output.includes('already exists')) {
      const refreshed = listNamespaces();
      preview = refreshed.find((item) => item && item.title === previewTitle)?.id;
    } else {
      throw new Error(`Failed to create HEALTH_KV preview namespace:\\n${created.output}`);
    }
  }

  if (!prod || !preview) {
    throw new Error('Failed to resolve HEALTH_KV namespace ids.');
  }

  return {
    id: prod,
    previewId: preview,
  };
}

function buildSecretsPayload(env) {
  const payload = {};

  for (const key of DEPLOY_SECRET_KEYS) {
    const value = process.env[key] ?? env[key];
    if (value === undefined || value === '') {
      continue;
    }
    payload[key] = value;
  }

  if (!payload.GATEWAY_API_KEY) {
    throw new Error('GATEWAY_API_KEY is required in .env for deployment.');
  }

  return payload;
}

function uploadSecrets(configPath, payload) {
  writeFileSync(TMP_SECRETS_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  try {
    run('npx', ['wrangler', 'secret', 'bulk', TMP_SECRETS_JSON, '--config', configPath]);
  } finally {
    rmSync(TMP_SECRETS_JSON, { force: true });
  }
}

function extractWorkersDevUrl(output) {
  const match = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  return match ? match[0] : null;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const skipSecrets = args.has('--skip-secrets');
  const prepareOnly = args.has('--prepare-only');

  console.log('Checking Cloudflare auth...');
  run('npx', ['wrangler', 'whoami']);

  const env = readEnvFile();
  const template = readFileSync(WRANGLER_TEMPLATE, 'utf8');

  const workerName = parseWorkerName(template);
  const existingKv = parseHealthKvIds(template);
  const resolvedKv = resolveNamespaceIds(workerName, existingKv);

  let deployConfig = withKvIds(template, resolvedKv.id, resolvedKv.previewId);
  deployConfig = withVarsFromEnv(deployConfig, env);

  const audit = auditCloudflareCostConfig(deployConfig, WRANGLER_GENERATED);
  if (!audit.ok) {
    throw new Error(`Cloudflare cost audit failed:\n- ${audit.failures.join('\n- ')}`);
  }

  writeFileSync(WRANGLER_GENERATED, deployConfig, 'utf8');
  console.log(`Generated ${WRANGLER_GENERATED}`);

  if (!skipSecrets) {
    const payload = buildSecretsPayload(env);
    console.log(`Uploading ${Object.keys(payload).length} secrets...`);
    uploadSecrets(WRANGLER_GENERATED, payload);
  } else {
    console.log('Skipping secret upload (--skip-secrets)');
  }

  if (prepareOnly) {
    console.log('Preparation complete (--prepare-only).');
    return;
  }

  console.log('Deploying worker...');
  const deployOutput = run('npx', ['wrangler', 'deploy', '--config', WRANGLER_GENERATED], { capture: true });
  process.stdout.write(deployOutput);

  const url = extractWorkersDevUrl(deployOutput);
  if (url) {
    console.log(`\nDeployed URL: ${url}`);
  }
}

main();
