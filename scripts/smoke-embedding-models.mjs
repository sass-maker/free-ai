#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.FREE_AI_BASE_URL || 'https://free-ai-gateway.sarthakagrawal927.workers.dev';
const DEFAULT_MODEL = process.env.FREE_AI_SMOKE_EMBEDDING_MODEL || 'gemini-embedding-001';

function usage() {
  console.error(`Usage:
  node scripts/smoke-embedding-models.mjs [--base-url https://free-ai-gateway.<subdomain>.workers.dev] [--model gemini-embedding-001] [--json] [--allow-disabled]

Options:
  --base-url <url>   Gateway URL. Defaults to FREE_AI_BASE_URL or ${DEFAULT_BASE_URL}.
  --model <id>       Embedding model id or alias to require. Defaults to ${DEFAULT_MODEL}.
  --json             Print machine-readable JSON.
  --allow-disabled   Do not fail when the model is listed but disabled.

This is a read-only live smoke for /v1/models. It proves the deployed gateway
catalog exposes type="embedding" rows before downstream RAG services depend on
dynamic embedding model selection.`);
}

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    jsonOnly: false,
    requireEnabled: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--json') {
      out.jsonOnly = true;
      continue;
    }
    if (arg === '--allow-disabled') {
      out.requireEnabled = false;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`missing value for ${arg}`);
    i += 1;
    if (arg === '--base-url') out.baseUrl = value;
    else if (arg === '--model') out.model = value;
    else throw new Error(`unknown argument: ${arg}`);
  }
  out.baseUrl = out.baseUrl.replace(/\/+$/, '');
  return out;
}

function embeddingRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((item) => item && item.type === 'embedding');
}

export async function runEmbeddingModelCatalogSmoke(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = options.model ?? DEFAULT_MODEL;
  const requireEnabled = options.requireEnabled ?? true;

  try {
    const res = await fetchImpl(`${baseUrl}/v1/models`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await res.json().catch(() => ({}));
    const embeddings = embeddingRows(payload);
    const selected = embeddings.find((item) => item.id === model || item.aliases?.includes?.(model)) ?? null;
    const ok = res.ok && embeddings.length > 0 && Boolean(selected) && (!requireEnabled || selected.enabled !== false);

    return {
      ok,
      base_url: baseUrl,
      model,
      status: res.status,
      embedding_model_count: embeddings.length,
      selected: selected ? {
        id: selected.id,
        provider: selected.provider ?? null,
        dimensions: typeof selected.dimensions === 'number' ? selected.dimensions : null,
        supports_dimensions: selected.supports_dimensions === true,
        aliases: Array.isArray(selected.aliases) ? selected.aliases : [],
        priority: typeof selected.priority === 'number' ? selected.priority : null,
        enabled: selected.enabled !== false,
      } : null,
      error: ok ? null : selected && selected.enabled === false && requireEnabled
        ? 'embedding model is disabled'
        : embeddings.length === 0
          ? 'no embedding models returned'
          : selected
            ? null
            : 'required embedding model not found',
    };
  } catch (error) {
    return {
      ok: false,
      base_url: baseUrl,
      model,
      status: null,
      embedding_model_count: 0,
      selected: null,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

function printHuman(report) {
  const selected = report.selected
    ? ` provider=${report.selected.provider} dimensions=${report.selected.dimensions} supports_dimensions=${report.selected.supports_dimensions} enabled=${report.selected.enabled}`
    : '';
  console.log(`${report.ok ? 'PASS' : 'FAIL'} embedding-model-catalog model=${report.model} count=${report.embedding_model_count}${selected}`);
  if (report.error) console.log(`error=${report.error}`);
  console.log(`\n${report.ok ? 'READY' : 'NOT READY'} ${report.base_url}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await runEmbeddingModelCatalogSmoke(args);
    if (args.jsonOnly) console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    usage();
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
