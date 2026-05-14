import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WRANGLER_PATH = resolve(process.cwd(), 'wrangler.toml');

function getBlock(toml, header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = toml.match(new RegExp(`^\\[${escaped}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm'));
  return match?.[1] ?? '';
}

function getScalar(block, key) {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*([^\\n#]+)`, 'm'));
  return match?.[1]?.trim();
}

function getStringValue(raw) {
  if (!raw) return undefined;
  const match = raw.match(/^"([^"]*)"$/);
  return match ? match[1] : raw;
}

export function auditCloudflareCostConfig(toml, source = 'wrangler.toml') {
  const failures = [];
  const warnings = [];

  const observability = getBlock(toml, 'observability');
  if (observability) {
    const enabled = getStringValue(getScalar(observability, 'enabled'));
    const sampling = Number(getScalar(observability, 'head_sampling_rate') ?? 0);
    if (enabled === 'true' || sampling > 0) {
      failures.push(
        'Workers Logs/observability sampling is enabled. Workers Logs can create paid overage on Workers Paid plans; keep it off in committed config.',
      );
    }
  }

  const limits = getBlock(toml, 'limits');
  const cpuMs = Number(getScalar(limits, 'cpu_ms') ?? 10);
  if (Number.isFinite(cpuMs) && cpuMs > 10) {
    failures.push(
      `Worker cpu_ms is ${cpuMs}. The free-plan CPU limit is 10ms per invocation, so committed config must not request a higher paid-plan limit.`,
    );
  }

  const vars = getBlock(toml, 'vars');
  const workersAiEnabled = getStringValue(getScalar(vars, 'WORKERS_AI_ENABLED'));
  if (workersAiEnabled === 'true') {
    failures.push(
      'WORKERS_AI_ENABLED is true in committed config. Keep Workers AI disabled by default; opt in only after confirming the Cloudflare plan cannot bill overages.',
    );
  }

  if (/^\[\[unsafe\.bindings\]\][\s\S]*?type\s*=\s*"ratelimit"/m.test(toml)) {
    failures.push(
      'An unsafe Rate Limiting binding is configured. The gateway already uses IpRateLimitDO, so remove unused paid/plan-sensitive bindings.',
    );
  }

  if (/^\[ai\]\s*$/m.test(toml) && !/name\s*=\s*"NEURON_BUDGET"/.test(toml)) {
    failures.push('Workers AI binding exists without the NEURON_BUDGET Durable Object guard.');
  }

  if (/^\[ai\]\s*$/m.test(toml) && !/WORKERS_AI_ENABLED\s*=\s*"false"/.test(toml)) {
    warnings.push('Workers AI binding is present; runtime calls must remain gated by WORKERS_AI_ENABLED and NEURON_BUDGET.');
  }

  return {
    ok: failures.length === 0,
    source,
    failures,
    warnings,
  };
}

function main() {
  const configPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_WRANGLER_PATH;
  const toml = readFileSync(configPath, 'utf8');
  const result = auditCloudflareCostConfig(toml, configPath);

  if (!result.ok) {
    console.error(`Cloudflare cost audit failed for ${result.source}:`);
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Cloudflare cost audit passed for ${result.source}`);
  for (const warning of result.warnings) {
    console.warn(`- ${warning}`);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  main();
}
