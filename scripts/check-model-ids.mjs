#!/usr/bin/env node
/**
 * Checks each provider's /v1/models endpoint against our config.
 * Outputs a report of stale/missing models and optionally patches config.ts.
 *
 * Usage:
 *   GROQ_API_KEY=... OPENROUTER_API_KEY=... CEREBRAS_API_KEY=... GEMINI_API_KEY=... node scripts/check-model-ids.mjs
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

// Each fetcher returns { all: Set (every id upstream, for stale check),
//                         addable: Set (filtered for new-add candidates) }
async function fetchGroqModels() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const all = new Set(data.data.map((m) => m.id));
  // Only chat-suitable models added automatically
  const isChat = (id) => !/whisper|playai-tts|prompt-guard|guard|orpheus|allam|compound/i.test(id);
  const addable = new Set(data.data.filter((m) => isChat(m.id)).map((m) => m.id));
  return { all, addable };
}

async function fetchOpenRouterModels() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const all = new Set(data.data.map((m) => m.id));
  const isFree = (m) => {
    const p = m.pricing || {};
    return String(p.prompt) === '0' && String(p.completion) === '0';
  };
  const isTextChat = (m) => {
    const id = String(m.id).toLowerCase();
    if (
      /image|audio|tts|search-preview|deep-research|moderation|guard|content-safety|palmyra|embed|speech|voxtral|lyria|reka-edge/.test(
        id
      )
    )
      return false;
    if (m.architecture?.output_modalities) {
      if (!m.architecture.output_modalities.includes('text')) return false;
    }
    return true;
  };
  const addable = new Set(data.data.filter((m) => isFree(m) && isTextChat(m)).map((m) => m.id));
  return { all, addable };
}

async function fetchCerebrasModels() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.cerebras.ai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const all = new Set(data.data.map((m) => m.id));
  return { all, addable: all };
}

async function fetchGeminiModels() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const all = new Set(data.models.map((m) => m.name.replace('models/', '')));
  // Only chat-capable generative models for addition (skip embedding / tts / imagen variants here via name prefix)
  const isChat = (id) => /^gemini-/.test(id) && !/embedding|image/i.test(id);
  const addable = new Set([...all].filter(isChat));
  return { all, addable };
}

// ── Parse current config ─────────────────────────────────────────────────────

function parseConfigModels() {
  const src = readFileSync(CONFIG_PATH, 'utf-8');
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [groq, openrouter, cerebras, gemini] = await Promise.all([
    fetchGroqModels(),
    fetchOpenRouterModels(),
    fetchCerebrasModels(),
    fetchGeminiModels(),
  ]);

  const providerSets = { groq, openrouter, cerebras, gemini };
  const configModels = parseConfigModels();

  const report = { stale: [], ok: [], skipped: [], new: [] };

  // Build a map of provider -> configured model IDs (for new-detection)
  const configured = {
    groq: new Set(),
    openrouter: new Set(),
    cerebras: new Set(),
    gemini: new Set(),
  };
  for (const entry of configModels) {
    if (configured[entry.provider]) configured[entry.provider].add(entry.model);
  }

  for (const entry of configModels) {
    const sets = providerSets[entry.provider];
    if (sets === null || sets === undefined) {
      report.skipped.push({ ...entry, reason: 'no API key / fetch failed' });
      continue;
    }
    // Use .all for stale check — if ANY upstream list has the id, it's valid
    if (sets.all.has(entry.model)) {
      report.ok.push(entry);
    } else {
      report.stale.push(entry);
    }
  }

  // Detect new models — use .addable (filtered) so we only auto-add chat/free ones
  for (const [provider, sets] of Object.entries(providerSets)) {
    if (!sets) continue;
    for (const model of sets.addable) {
      if (!configured[provider].has(model)) {
        report.new.push({ provider, model });
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.stale.length === 0) {
      console.log(
        `✓ All ${report.ok.length} checked models are valid (${report.skipped.length} skipped)`
      );
    } else {
      console.log(`⚠ ${report.stale.length} stale model(s) found:\n`);
      for (const m of report.stale) {
        console.log(`  ${m.provider}/${m.model}  (id: ${m.id})`);
      }
      console.log(`\n✓ ${report.ok.length} valid, ${report.skipped.length} skipped`);
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
      const limitRe = new RegExp(`\\s*'${limitKey}':\\s*\\{[^}]*\\},?\\n?`, 'g');
      src = src.replace(limitRe, '\n');
    }

    // Add new — inject safe defaults just before DEFAULT_MODELS closing `];`
    if (report.new.length > 0) {
      const _provComment = {
        groq: 'Groq',
        openrouter: 'OpenRouter',
        cerebras: 'Cerebras',
        gemini: 'Gemini',
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
    enabled: true,
    priority: 0.50, // AUTO-ADDED by check-model-ids — review caps + priority
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
    if (report.new.length) parts.push(`added ${report.new.length} new`);
    console.log(`\nPatched config.ts — ${parts.join(', ')}`);
  }

  // Signal CI to act only when read-only and there's drift
  if (!PATCH && (report.stale.length > 0 || report.new.length > 0)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
