/** Conservative Workers AI reservations and the global budget client. */
import type { ChatMessage, Env } from '../types';

const DO_ORIGIN = 'https://internal.local';
const DAILY_NEURON_CAP = 9500;
const NEURON_BUFFER = 1.2;
const MAX_OUTPUT_TOKENS = 8192;
export const DEFAULT_WORKERS_AI_OUTPUT_TOKENS = 512;

interface TokenPricing {
  input: number;
  output: number;
}
const TEXT_TOKEN_PRICING: Record<string, TokenPricing> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26668, output: 204805 },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { input: 45170, output: 443756 },
  '@cf/meta/llama-3.1-8b-instruct': { input: 25608, output: 75147 },
  '@cf/meta/llama-3-8b-instruct': { input: 25608, output: 75147 },
  '@cf/meta/llama-3.2-3b-instruct': { input: 4625, output: 30475 },
  '@cf/meta/llama-3.2-1b-instruct': { input: 2457, output: 18252 },
  '@cf/mistral/mistral-7b-instruct-v0.1': { input: 10000, output: 17300 },
};
const EMBEDDING_NEURONS_PER_MILLION_TOKENS: Record<string, number> = {
  '@cf/baai/bge-base-en-v1.5': 6058,
  '@cf/baai/bge-small-en-v1.5': 1841,
  '@cf/baai/bge-large-en-v1.5': 18582,
};

export interface DebitResult {
  allowed: boolean;
  used: number;
  remaining: number;
  retryAfter: number;
  dayKey: string;
}
const denied = (): DebitResult => ({
  allowed: false,
  used: 0,
  remaining: 0,
  retryAfter: 60,
  dayKey: '',
});
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Images in chat have no priced upper bound, so they cannot use Workers AI. */
export function estimateChatInputBytes(messages: ChatMessage[]): number | null {
  if (
    messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type !== 'text')
    )
  )
    return null;
  return bytes(JSON.stringify(messages));
}

/** One byte per token is deliberately conservative for UTF-8 text. */
export function estimateNeuronCost(
  model: string,
  params?: { inputBytes?: number; outputTokens?: number }
): number | null {
  const inputBytes = params?.inputBytes ?? 0;
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0) return null;
  const inputTokens = Math.max(1, inputBytes);
  const outputTokens = params?.outputTokens ?? DEFAULT_WORKERS_AI_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > MAX_OUTPUT_TOKENS)
    return null;
  const text = TEXT_TOKEN_PRICING[model];
  if (text)
    return Math.max(
      1,
      Math.ceil(
        ((inputTokens * text.input + outputTokens * text.output) / 1_000_000) * NEURON_BUFFER
      )
    );
  const embeddingRate = EMBEDDING_NEURONS_PER_MILLION_TOKENS[model];
  if (embeddingRate)
    return Math.max(1, Math.ceil((inputTokens * embeddingRate * NEURON_BUFFER) / 1_000_000));
  return null;
}

function getBudgetStub(env: Env) {
  const ns = (env as unknown as { NEURON_BUDGET?: DurableObjectNamespace }).NEURON_BUDGET;
  return ns?.get(ns.idFromName('global-budget')) ?? null;
}

function validDay(dayKey: unknown): dayKey is string {
  return (
    typeof dayKey === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(dayKey) &&
    Number.isFinite(Date.parse(dayKey)) &&
    new Date(dayKey).toISOString().slice(0, 10) === dayKey &&
    dayKey === new Date().toISOString().slice(0, 10)
  );
}

function validDebit(value: unknown, neurons: number): value is DebitResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<DebitResult>;
  if (
    typeof result.allowed !== 'boolean' ||
    !Number.isSafeInteger(result.used) ||
    !Number.isSafeInteger(result.remaining) ||
    !Number.isSafeInteger(result.retryAfter) ||
    (result.allowed && (result.used as number) < neurons) ||
    (result.used as number) > DAILY_NEURON_CAP ||
    (result.remaining as number) < 0 ||
    (result.used as number) + (result.remaining as number) !== DAILY_NEURON_CAP ||
    !validDay(result.dayKey)
  )
    return false;
  return result.allowed ? result.retryAfter === 0 : (result.retryAfter as number) > 0;
}

export async function tryDebitNeurons(env: Env, neurons: number | null): Promise<DebitResult> {
  if (
    neurons === null ||
    !Number.isSafeInteger(neurons) ||
    neurons < 1 ||
    neurons > DAILY_NEURON_CAP
  )
    return denied();
  try {
    const stub = getBudgetStub(env);
    if (!stub) return denied();
    const response = await stub.fetch(`${DO_ORIGIN}/try-debit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ neurons }),
    });
    if (!response.ok) return denied();
    const result: unknown = await response.json();
    return validDebit(result, neurons) ? result : denied();
  } catch {
    return denied();
  }
}

export async function getNeuronUsage(
  env: Env
): Promise<{ used: number; remaining: number; cap: number; dayKey: string } | null> {
  try {
    const stub = getBudgetStub(env);
    if (!stub) return null;
    const response = await stub.fetch(`${DO_ORIGIN}/usage`);
    if (!response.ok) return null;
    const result = (await response.json()) as {
      used?: unknown;
      remaining?: unknown;
      cap?: unknown;
      dayKey?: unknown;
    };
    if (
      !Number.isSafeInteger(result.used) ||
      !Number.isSafeInteger(result.remaining) ||
      result.cap !== DAILY_NEURON_CAP ||
      (result.used as number) < 0 ||
      (result.remaining as number) < 0 ||
      (result.used as number) + (result.remaining as number) !== DAILY_NEURON_CAP ||
      !validDay(result.dayKey)
    )
      return null;
    return result as { used: number; remaining: number; cap: number; dayKey: string };
  } catch {
    return null;
  }
}

export function buildBudgetExhaustedResponse(result: DebitResult): Response {
  const unavailable = !result.dayKey;
  return Response.json(
    {
      error: {
        message: unavailable
          ? 'Workers AI budget reservation is unavailable.'
          : `Daily Workers AI Neuron budget exhausted (${result.used}/${DAILY_NEURON_CAP}). Retry after UTC midnight.`,
        type: 'service_unavailable',
        code: unavailable ? 'neuron_budget_unavailable' : 'neuron_budget_exhausted',
      },
      x_budget: { used: result.used, remaining: result.remaining, day_key: result.dayKey },
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
