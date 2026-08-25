#!/usr/bin/env node
/**
 * Checks each provider's /v1/models endpoint against our config.
 * Outputs a report of stale/missing models and optionally patches config.ts.
 *
 * Usage:
 *   GROQ_API_KEY=... CEREBRAS_API_KEY=... GEMINI_API_KEY=... node scripts/check-model-ids.mjs
 *
 * OpenRouter's model catalog is public. OPENROUTER_API_KEY is optional and is
 * sent only when present; the other checked catalogs still require keys.
 *
 * Flags:
 *   --patch   Rewrite config.ts, removing models that no longer exist
 *   --json    Output machine-readable JSON report
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../src/config.ts');
const PATCH = process.argv.includes('--patch');
const JSON_OUT = process.argv.includes('--json');

// ── Provider API fetchers ────────────────────────────────────────────────────

const MODEL_LIST_TIMEOUT_MS = 10_000;
const NON_CHAT_MODEL =
  /image|audio|tts|search-preview|deep-research|moderation|guard|content-safety|palmyra|embed|speech|whisper|voxtral|lyria|playai|orpheus/i;

function asModelItems(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.models)) return body.models;
  if (Array.isArray(body)) return body;
  return null;
}

function modelId(item) {
  if (typeof item === 'string') return item;
  if (typeof item?.id === 'string') return item.id;
  if (typeof item?.name === 'string') return item.name.split('models/').join('');
  return null;
}

function isTextModel(item) {
  const id = modelId(item);
  if (!id || NON_CHAT_MODEL.test(id)) return false;
  const outputs = item?.architecture?.output_modalities;
  return !Array.isArray(outputs) || outputs.includes('text');
}

function isOpenRouterFree(item) {
  const pricing = item?.pricing ?? {};
  return String(pricing.prompt) === '0' && String(pricing.completion) === '0';
}

const CATALOG_SPECS = [
  {
    provider: 'workers_ai',
    unsupported: 'model discovery uses the Cloudflare binding rather than an HTTP catalog',
  },
  {
    provider: 'groq',
    secret: 'GROQ_API_KEY',
    url: () => 'https://api.groq.com/openai/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
    discover: (item) => isTextModel(item) && !/allam|compound/i.test(modelId(item)),
  },
  {
    provider: 'openrouter',
    secret: 'OPENROUTER_API_KEY',
    optionalSecret: true,
    url: () => 'https://openrouter.ai/api/v1/models',
    headers: ({ key }) => (key ? { Authorization: `Bearer ${key}` } : {}),
    discover: (item) => isTextModel(item) && isOpenRouterFree(item),
  },
  {
    provider: 'cerebras',
    secret: 'CEREBRAS_API_KEY',
    url: () => 'https://api.cerebras.ai/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
    discover: isTextModel,
  },
  {
    provider: 'gemini',
    secret: 'GEMINI_API_KEY',
    url: () => 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: ({ key }) => ({ 'x-goog-api-key': key }),
    discover: (item) => /^gemini-/.test(modelId(item)) && isTextModel(item),
  },
  {
    provider: 'sambanova',
    secret: 'SAMBANOVA_API_KEY',
    url: () => 'https://api.sambanova.ai/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'nvidia',
    secret: 'NVIDIA_API_KEY',
    url: () => 'https://integrate.api.nvidia.com/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'github_models',
    secret: 'GITHUB_MODELS_TOKEN',
    url: () => 'https://models.github.ai/catalog/models',
    headers: ({ key }) => ({
      Authorization: `Bearer ${key}`,
      Accept: 'application/vnd.github+json',
    }),
  },
  {
    provider: 'pollinations',
    unsupported: 'no stable official text model-list contract is configured',
  },
  {
    provider: 'cohere',
    secret: 'COHERE_API_KEY',
    url: () => 'https://api.cohere.ai/compatibility/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'mistral',
    secret: 'MISTRAL_API_KEY',
    url: () => 'https://api.mistral.ai/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'zai',
    secret: 'ZAI_API_KEY',
    url: () => 'https://api.z.ai/api/paas/v4/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'modelscope',
    secret: 'MODELSCOPE_API_KEY',
    url: () => 'https://api-inference.modelscope.cn/v1/models',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    provider: 'siliconflow',
    secret: 'SILICONFLOW_API_KEY',
    url: () => 'https://api.siliconflow.com/v1/models?type=text',
    headers: ({ key }) => ({ Authorization: `Bearer ${key}` }),
  },
];

async function fetchCatalog(spec, env = process.env, fetchImpl = fetch) {
  if (spec.unsupported) {
    return {
      provider: spec.provider,
      status: 'unsupported',
      reason: spec.unsupported,
      all: new Set(),
      addable: new Set(),
    };
  }

  const key = env[spec.secret];
  if (!key && !spec.optionalSecret) {
    return {
      provider: spec.provider,
      status: 'missing_key',
      reason: `${spec.secret} is not configured`,
      all: new Set(),
      addable: new Set(),
    };
  }

  try {
    const response = await fetchImpl(spec.url({ key }), {
      headers: spec.headers({ key }),
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        provider: spec.provider,
        status: 'error',
        reason: `catalog returned HTTP ${response.status}`,
        all: new Set(),
        addable: new Set(),
      };
    }

    const body = await response.json();
    const items = asModelItems(body);
    if (!items) {
      return {
        provider: spec.provider,
        status: 'error',
        reason: 'catalog response did not contain a model array',
        all: new Set(),
        addable: new Set(),
      };
    }

    const validItems = items.filter((item) => modelId(item));
    const all = new Set(validItems.map(modelId));
    const addable = new Set(spec.discover ? validItems.filter(spec.discover).map(modelId) : []);
    return {
      provider: spec.provider,
      status: 'ok',
      reason: null,
      all,
      addable,
    };
  } catch (error) {
    return {
      provider: spec.provider,
      status: 'error',
      reason: error instanceof Error ? error.message : 'catalog request failed',
      all: new Set(),
      addable: new Set(),
    };
  }
}

export async function fetchCatalogs(env = process.env, fetchImpl = fetch) {
  return Promise.all(CATALOG_SPECS.map((spec) => fetchCatalog(spec, env, fetchImpl)));
}

// ── Parse current config ─────────────────────────────────────────────────────

export function parseConfigModels(source = readFileSync(CONFIG_PATH, 'utf-8')) {
  const registryStart = source.indexOf('const DEFAULT_MODELS: ModelCandidate[] = [');
  const limitsStart = source.indexOf('const DEFAULT_LIMITS:', registryStart);
  const src =
    registryStart >= 0 && limitsStart > registryStart
      ? source.slice(registryStart, limitsStart)
      : source;
  const models = [];
  // Match each object in DEFAULT_MODELS array
  const blockRe =
    /\{[^}]*?id:\s*'([^']+)'[^}]*?provider:\s*'([^']+)'[^}]*?model:\s*'([^']+)'[^}]*?\}/gs;
  let match;
  while ((match = blockRe.exec(src)) !== null) {
    models.push({ id: match[1], provider: match[2], model: match[3] });
  }
  return models;
}

export function buildRegistryReport(configModels, catalogResults) {
  const catalogMap = new Map(catalogResults.map((catalog) => [catalog.provider, catalog]));
  const configured = new Map();
  const report = {
    catalogs: [],
    stale: [],
    ok: [],
    skipped: [],
    new: [],
    summary: {
      configuredModels: configModels.length,
      managedCatalogs: CATALOG_SPECS.length,
      checkedCatalogs: 0,
      incompleteCatalogs: 0,
      credentialGaps: 0,
      catalogErrors: 0,
      unsupportedCatalogs: 0,
    },
  };

  for (const catalog of catalogResults) {
    report.catalogs.push({
      provider: catalog.provider,
      status: catalog.status,
      reason: catalog.reason,
      upstreamModels: catalog.all.size,
      discoverableModels: catalog.addable.size,
    });
    if (catalog.status === 'ok') report.summary.checkedCatalogs += 1;
    else if (catalog.status === 'unsupported') report.summary.unsupportedCatalogs += 1;
    else {
      report.summary.incompleteCatalogs += 1;
      if (catalog.status === 'missing_key') report.summary.credentialGaps += 1;
      else report.summary.catalogErrors += 1;
    }
  }

  for (const entry of configModels) {
    if (!configured.has(entry.provider)) configured.set(entry.provider, new Set());
    configured.get(entry.provider).add(entry.model);

    const catalog = catalogMap.get(entry.provider);
    if (!catalog) {
      report.skipped.push({ ...entry, reason: 'catalog unsupported' });
    } else if (catalog.status !== 'ok') {
      report.skipped.push({ ...entry, reason: `${catalog.status}: ${catalog.reason}` });
    } else if (catalog.all.has(entry.model)) {
      report.ok.push(entry);
    } else {
      report.stale.push(entry);
    }
  }

  for (const catalog of catalogResults) {
    if (catalog.status !== 'ok') continue;
    const providerModels = configured.get(catalog.provider) ?? new Set();
    for (const model of catalog.addable) {
      if (!providerModels.has(model)) report.new.push({ provider: catalog.provider, model });
    }
  }

  return report;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const configModels = parseConfigModels();
  const catalogs = await fetchCatalogs();
  const report = buildRegistryReport(configModels, catalogs);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.stale.length === 0) {
      console.log(
        `✓ All ${report.ok.length} checked models are valid (${report.skipped.length} skipped; ${report.summary.checkedCatalogs}/${report.summary.managedCatalogs} catalogs checked)`
      );
    } else {
      console.log(`⚠ ${report.stale.length} stale model(s) found:\n`);
      for (const m of report.stale) {
        console.log(`  ${m.provider}/${m.model}  (id: ${m.id})`);
      }
      console.log(`\n✓ ${report.ok.length} valid, ${report.skipped.length} skipped`);
    }
    for (const catalog of report.catalogs.filter((item) => item.status !== 'ok')) {
      console.log(`⚠ ${catalog.provider}: ${catalog.status} (${catalog.reason})`);
    }
    if (report.new.length > 0) {
      console.log(`\n✨ ${report.new.length} new model(s) upstream not in config:`);
      for (const m of report.new) console.log(`  ${m.provider}/${m.model}`);
    }
  }

  // ── Patch config if requested ──────────────────────────────────────────
  if (PATCH && (report.stale.length > 0 || report.new.length > 0)) {
    let src = readFileSync(CONFIG_PATH, 'utf-8');

    // Remove stale — uses brace-counter (regex alone fails on nested `capabilities: {...}`)
    const removeBlockById = (source, id) => {
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const idRe = new RegExp(`id:\\s*'${escapedId}'`);
      const idIdx = source.search(idRe);
      if (idIdx === -1) return source;
      // Walk back to opening `{`
      let start = idIdx;
      while (start > 0 && source[start] !== '{') start--;
      // Include the line's leading indentation so removal doesn't orphan it
      let lineStart = start;
      while (lineStart > 0 && (source[lineStart - 1] === ' ' || source[lineStart - 1] === '\t'))
        lineStart--;
      if (lineStart === 0 || source[lineStart - 1] === '\n') start = lineStart;
      // Walk forward matching braces
      let depth = 0;
      let end = start;
      for (let i = start; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      // Prefer removing the block's own trailing comma. If the block is the
      // final element and has no trailing comma, remove the preceding comma.
      if (source[end] === ',') {
        end++;
        while (end < source.length && /[ \t]/.test(source[end])) end++;
        if (source[end] === '\n') end++;
      } else {
        let before = start - 1;
        while (before >= 0 && /\s/.test(source[before])) before--;
        if (source[before] === ',') start = before;
      }
      return source.slice(0, start) + source.slice(end);
    };

    for (const m of report.stale) {
      src = removeBlockById(src, m.id);

      // Remove corresponding limit entry (not nested — simple regex OK)
      const limitKey = `${m.provider}:${m.model}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const limitRe = new RegExp(`^[ \\t]*'${limitKey}':\\s*\\{[^}]*\\},?[^\\n]*(?:\\n|$)`, 'gm');
      src = src.replace(limitRe, '\n');
    }

    // Stage new models disabled. Provider metadata is discovery evidence, not
    // runtime compatibility proof; enable only after a provider-level smoke.
    if (report.new.length > 0) {
      const _provComment = {
        groq: 'Groq',
        openrouter: 'OpenRouter',
        cerebras: 'Cerebras',
        gemini: 'Gemini',
        sambanova: 'SambaNova',
        nvidia: 'NVIDIA',
        github_models: 'GitHub Models',
        cohere: 'Cohere',
        mistral: 'Mistral',
        zai: 'Z.ai',
        modelscope: 'ModelScope',
        siliconflow: 'SiliconFlow',
      };
      const stubs = report.new
        .map((m) => {
          // slugify id from provider+model
          const slug = `${m.provider}-${m.model.replace(/[^a-z0-9]+/gi, '-')}`
            .toLowerCase()
            .slice(0, 60);
          return `  {
    id: '${slug}',
    provider: '${m.provider}',
    model: '${m.model}',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: false,
    priority: 0.50, // AUTO-STAGED — smoke before enabling; then review caps + priority
    capabilities: { toolCalling: false, jsonMode: true, vision: false, contextWindow: 32768, maxOutputTokens: 4096 },
  },`;
        })
        .join('\n');

      const modelsStart = src.indexOf('const DEFAULT_MODELS: ModelCandidate[] = [');
      const limitsStart = src.indexOf('const DEFAULT_LIMITS:', modelsStart);
      const modelsEnd =
        modelsStart === -1 || limitsStart === -1 ? -1 : src.lastIndexOf('\n];', limitsStart);
      if (modelsStart !== -1 && modelsEnd !== -1) {
        src =
          src.slice(0, modelsEnd) +
          `\n\n  // ── Auto-added by weekly model check (review priority + capabilities) ──\n${stubs}` +
          src.slice(modelsEnd);
      }

      // Add limits section entries
      const limitStubs = report.new
        .map((m) => `  '${m.provider}:${m.model}': { requestsPerDay: 100 }, // AUTO-ADDED — tune`)
        .join('\n');
      const limitMarker =
        /(const DEFAULT_LIMITS: Record<string, ProviderLimitConfig> = \{[\s\S]*?)(\n\};)/;
      if (limitMarker.test(src)) {
        src = src.replace(limitMarker, `$1\n  // AUTO-ADDED limits\n${limitStubs}$2`);
      }
    }

    src = src.replace(/\n{3,}/g, '\n\n');
    writeFileSync(CONFIG_PATH, src);
    const parts = [];
    if (report.stale.length) parts.push(`removed ${report.stale.length} stale`);
    if (report.new.length) parts.push(`staged ${report.new.length} new (disabled)`);
    console.log(`\nPatched config.ts — ${parts.join(', ')}`);
  }

  // Signal the caller when maintenance review is needed. The workflow keeps
  // missing optional catalog credentials visible in its issue, while using
  // the separate live-health check as the product-availability gate.
  if (
    !PATCH &&
    (report.stale.length > 0 || report.new.length > 0 || report.summary.incompleteCatalogs > 0)
  )
    process.exit(1);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
