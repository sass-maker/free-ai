import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WRANGLER_PATH = resolve(process.cwd(), 'wrangler.toml');
const DEFAULT_NEURON_BUDGET_PATH = resolve(process.cwd(), 'src/state/neuron-budget-do.ts');

function getBlock(toml, header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = toml.match(
    new RegExp(`^\\[${escaped}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm')
  );
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

function readDailyNeuronCap(path = DEFAULT_NEURON_BUDGET_PATH) {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/DAILY_NEURON_CAP\s*=\s*(\d+)/);
  return match ? Number(match[1]) : Number.NaN;
}

export function auditCloudflareCostConfig(toml, source = 'wrangler.toml', options = {}) {
  const failures = [];
  const warnings = [];

  const observability = getBlock(toml, 'observability');
  if (observability) {
    const enabled = getStringValue(getScalar(observability, 'enabled'));
    const sampling = Number(getScalar(observability, 'head_sampling_rate') ?? 0);
    if (enabled === 'true' || sampling > 0) {
      failures.push(
        'Workers Logs/observability sampling is enabled. Workers Logs can create paid overage on Workers Paid plans; keep it off in committed config.'
      );
    }
  }

  const limits = getBlock(toml, 'limits');
  const cpuMs = Number(getScalar(limits, 'cpu_ms') ?? 10);
  if (Number.isFinite(cpuMs) && cpuMs > 10) {
    failures.push(
      `Worker cpu_ms is ${cpuMs}. The free-plan CPU limit is 10ms per invocation, so committed config must not request a higher paid-plan limit.`
    );
  }

  const vars = getBlock(toml, 'vars');
  const workersAiEnabled = getStringValue(getScalar(vars, 'WORKERS_AI_ENABLED'));
  const hasAiBinding = /^\[ai\]\s*$/m.test(toml);
  const hasNeuronBudget = /name\s*=\s*"NEURON_BUDGET"/.test(toml);

  if (/^\[\[unsafe\.bindings\]\][\s\S]*?type\s*=\s*"ratelimit"/m.test(toml)) {
    failures.push(
      'An unsafe Rate Limiting binding is configured. The gateway already uses IpRateLimitDO, so remove unused paid/plan-sensitive bindings.'
    );
  }

  if (hasAiBinding && !hasNeuronBudget) {
    failures.push('Workers AI binding exists without the NEURON_BUDGET Durable Object guard.');
  }

  if (hasAiBinding && workersAiEnabled === 'true') {
    const neuronCap = options.dailyNeuronCap ?? readDailyNeuronCap(options.neuronBudgetPath);
    if (!Number.isFinite(neuronCap)) {
      failures.push('Workers AI is enabled, but the DAILY_NEURON_CAP guard could not be read.');
    } else if (neuronCap > 9_500) {
      failures.push(
        `Workers AI is enabled with DAILY_NEURON_CAP=${neuronCap}. Keep the committed cap at or below 9500 neurons/day.`
      );
    } else {
      warnings.push(
        `Workers AI is enabled as a fallback; NEURON_BUDGET caps committed usage at ${neuronCap} neurons/day.`
      );
    }
  } else if (hasAiBinding) {
    warnings.push(
      'Workers AI binding is present; runtime calls must remain gated by WORKERS_AI_ENABLED and NEURON_BUDGET.'
    );
  }

  return {
    ok: failures.length === 0,
    source,
    failures,
    warnings,
  };
}

function main() {
  const configPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_WRANGLER_PATH;
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
