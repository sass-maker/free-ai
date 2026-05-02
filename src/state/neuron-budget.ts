/**
 * Client + cost table for the NeuronBudgetDO.
 *
 * Centralises Workers AI Neuron pricing estimates and the call to the DO.
 * Used by every code path that hits `env.AI.run(...)` so we never overshoot
 * the daily 9500-Neuron budget (500 below the 10k/day free quota).
 *
 * Cost reference (rough, conservative, per-call). Workers AI bills per-token
 * but Cloudflare publishes only Neuron coefficients per model, not stable
 * per-token formulae — so we round generously upward. See:
 *   https://developers.cloudflare.com/workers-ai/platform/pricing/
 */

import type { Env } from '../types';

const DO_ORIGIN = 'https://internal.local';

/**
 * Default Neuron cost when the model is unknown. Sized to favour budget
 * preservation: better to under-serve than to overshoot.
 */
const DEFAULT_NEURON_COST = 80;

/**
 * Per-call Neuron estimates, keyed by Workers AI model id. Numbers are
 * intentionally rounded high. When a per-token figure is published we can
 * swap to a token-based estimator (input * inFactor + output * outFactor).
 */
const NEURONS_BY_MODEL: Record<string, number> = {
  // Text generation
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 80,
  '@cf/meta/llama-3.1-70b-instruct': 80,
  '@cf/meta/llama-3.1-8b-instruct': 12,
  '@cf/meta/llama-3-8b-instruct': 12,
  '@cf/meta/llama-3.2-3b-instruct': 8,
  '@cf/meta/llama-3.2-1b-instruct': 4,
  '@cf/mistral/mistral-7b-instruct-v0.1': 12,
  '@cf/qwen/qwen1.5-14b-chat-awq': 20,

  // Embeddings
  '@cf/baai/bge-base-en-v1.5': 1,
  '@cf/baai/bge-small-en-v1.5': 1,
  '@cf/baai/bge-large-en-v1.5': 2,

  // Images (per generation)
  '@cf/black-forest-labs/flux-1-schnell': 200,
  '@cf/stabilityai/stable-diffusion-xl-base-1.0': 200,
  '@cf/lykon/dreamshaper-8-lcm': 100,

  // Audio
  '@cf/openai/whisper': 30,
  '@cf/openai/whisper-large-v3-turbo': 30,
  '@cf/myshell-ai/melotts': 50,
  '@cf/deepgram/aura-1': 50,
};

export interface DebitResult {
  allowed: boolean;
  used: number;
  remaining: number;
  retryAfter: number;
  dayKey: string;
}

export function estimateNeuronCost(model: string, params?: { inputChars?: number }): number {
  const base = NEURONS_BY_MODEL[model] ?? DEFAULT_NEURON_COST;

  // Embedding models scale with input volume — bump cost for long batches.
  if (model.includes('/baai/') && params?.inputChars) {
    // ~4 chars/token, 1 Neuron per ~3k tokens. Round up.
    const estimatedTokens = Math.ceil(params.inputChars / 4);
    const overhead = Math.ceil(estimatedTokens / 3000);
    return base + overhead;
  }

  return base;
}

function getBudgetStub(env: Env) {
  const ns = (env as unknown as { NEURON_BUDGET?: DurableObjectNamespace }).NEURON_BUDGET;
  if (!ns) return null;
  const id = ns.idFromName('global-budget');
  return ns.get(id);
}

/**
 * Attempt to debit `neurons` from the daily Workers AI budget.
 *
 * Returns `{ allowed: false }` when the request would exceed the daily cap.
 * Returns `{ allowed: false }` when the binding is missing or unavailable.
 * This is a financial guardrail, so Workers AI calls fail closed instead of
 * risking billable usage when the Durable Object cannot enforce the budget.
 */
export async function tryDebitNeurons(env: Env, neurons: number): Promise<DebitResult> {
  const stub = getBudgetStub(env);
  if (!stub) {
    return { allowed: false, used: 0, remaining: 0, retryAfter: 60, dayKey: '' };
  }

  try {
    const response = await stub.fetch(`${DO_ORIGIN}/try-debit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ neurons }),
    });
    return (await response.json()) as DebitResult;
  } catch {
    return { allowed: false, used: 0, remaining: 0, retryAfter: 60, dayKey: '' };
  }
}

export async function getNeuronUsage(env: Env): Promise<{
  used: number;
  remaining: number;
  cap: number;
  dayKey: string;
} | null> {
  const stub = getBudgetStub(env);
  if (!stub) return null;
  try {
    const response = await stub.fetch(`${DO_ORIGIN}/usage`);
    return (await response.json()) as {
      used: number;
      remaining: number;
      cap: number;
      dayKey: string;
    };
  } catch {
    return null;
  }
}

/** Used by request handlers to short-circuit when the budget is exhausted. */
export function buildBudgetExhaustedResponse(result: DebitResult): Response {
  return Response.json(
    {
      error: {
        message: `Daily Workers AI Neuron budget exhausted (${result.used}/9500). Retry after UTC midnight.`,
        type: 'service_unavailable',
        code: 'neuron_budget_exhausted',
      },
      x_budget: {
        used: result.used,
        remaining: result.remaining,
        day_key: result.dayKey,
      },
    },
    {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(result.retryAfter || 60),
      },
    },
  );
}
