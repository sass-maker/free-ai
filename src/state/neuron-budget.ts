/**
 * Client + cost table for the NeuronBudgetDO.
 *
 * Centralises Workers AI Neuron pricing estimates and the call to the DO.
 * Used by every code path that hits `env.AI.run(...)` so we never overshoot
 * the daily 9500-Neuron budget (500 below the 10k/day free quota).
 *
 * Cost reference (rough, conservative). Cloudflare publishes model pricing in
 * dollars per million tokens while overage is billed per 1,000 neurons. We
 * convert those public token prices back into neuron estimates and add a small
 * buffer because the gateway only knows requested output length before a call.
 * See:
 *   https://developers.cloudflare.com/workers-ai/platform/pricing/
 */

import type { ChatMessage, ContentPart, Env } from '../types';

const DO_ORIGIN = 'https://internal.local';

/**
 * Default Neuron cost when the model is unknown. Sized to favour budget
 * preservation: better to under-serve than to overshoot.
 */
const DEFAULT_NEURON_COST = 80;

const NEURON_BUFFER = 1.2;
const DEFAULT_OUTPUT_TOKENS = 512;

interface TokenPricing {
  inputNeuronsPerMillion: number;
  outputNeuronsPerMillion: number;
}

const TEXT_TOKEN_PRICING: Record<string, TokenPricing> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
    inputNeuronsPerMillion: 26_668,
    outputNeuronsPerMillion: 204_805,
  },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': {
    inputNeuronsPerMillion: 45_170,
    outputNeuronsPerMillion: 443_756,
  },
  '@cf/meta/llama-3.1-8b-instruct': {
    inputNeuronsPerMillion: 25_608,
    outputNeuronsPerMillion: 75_147,
  },
  '@cf/meta/llama-3-8b-instruct': {
    inputNeuronsPerMillion: 25_608,
    outputNeuronsPerMillion: 75_147,
  },
  '@cf/meta/llama-3.2-3b-instruct': {
    inputNeuronsPerMillion: 4_625,
    outputNeuronsPerMillion: 30_475,
  },
  '@cf/meta/llama-3.2-1b-instruct': {
    inputNeuronsPerMillion: 2_457,
    outputNeuronsPerMillion: 18_252,
  },
  '@cf/mistral/mistral-7b-instruct-v0.1': {
    inputNeuronsPerMillion: 10_000,
    outputNeuronsPerMillion: 17_300,
  },
};

const EMBEDDING_NEURONS_PER_MILLION_TOKENS: Record<string, number> = {
  '@cf/baai/bge-base-en-v1.5': 3_109,
  '@cf/baai/bge-small-en-v1.5': 3_109,
  '@cf/baai/bge-large-en-v1.5': 14_000,
};

/**
 * Per-call Neuron estimates for models where preflight inputs do not map
 * cleanly to priced text tokens or the pricing page does not list the model.
 */
const FIXED_NEURONS_BY_MODEL: Record<string, number> = {
  // Text generation fallbacks
  '@cf/meta/llama-3.1-70b-instruct': 80,
  '@cf/qwen/qwen1.5-14b-chat-awq': 20,
  '@cf/google/gemma-7b-it-lora': 12,
  '@cf/microsoft/phi-2': 8,

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

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateChatInputChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') {
      return sum + message.content.length;
    }

    return (
      sum +
      message.content.reduce((partSum, part: ContentPart) => {
        if (part.type === 'text') {
          return partSum + part.text.length;
        }

        return partSum + 1_000;
      }, 0)
    );
  }, 0);
}

export function estimateNeuronCost(
  model: string,
  params?: { inputChars?: number; outputTokens?: number }
): number {
  const tokenPricing = TEXT_TOKEN_PRICING[model];
  if (tokenPricing) {
    const inputTokens = params?.inputChars ? estimateTokensFromChars(params.inputChars) : 1;
    const outputTokens = Math.max(1, params?.outputTokens ?? DEFAULT_OUTPUT_TOKENS);
    const inputNeurons = (inputTokens * tokenPricing.inputNeuronsPerMillion) / 1_000_000;
    const outputNeurons = (outputTokens * tokenPricing.outputNeuronsPerMillion) / 1_000_000;
    return Math.max(1, Math.ceil((inputNeurons + outputNeurons) * NEURON_BUFFER));
  }

  const embeddingRate = EMBEDDING_NEURONS_PER_MILLION_TOKENS[model];
  if (embeddingRate) {
    const inputTokens = params?.inputChars ? estimateTokensFromChars(params.inputChars) : 1;
    return Math.max(1, Math.ceil((inputTokens * embeddingRate * NEURON_BUFFER) / 1_000_000));
  }

  return FIXED_NEURONS_BY_MODEL[model] ?? DEFAULT_NEURON_COST;
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
    }
  );
}
