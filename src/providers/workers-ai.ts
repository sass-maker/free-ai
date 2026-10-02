import { isWorkersAiEnabled } from '../config';
import { MalformedProviderOutputError } from '../router/classify-error';
import {
  estimateChatInputBytes,
  estimateNeuronCost,
  DEFAULT_WORKERS_AI_OUTPUT_TOKENS,
  tryDebitNeurons,
} from '../state/neuron-budget';
import type { Env } from '../types';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';

class BudgetExhaustedError extends Error {
  readonly code = 'neuron_budget_exhausted';
  // Classified as usage_retriable (429) so routing falls back to the next
  // provider and cools this model down instead of aborting the request.
  readonly status = 429;
  readonly retryAfter: number;
  constructor(message: string, retryAfter: number) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

async function reserveWorkersAiBudget(env: Env, cost: number | null): Promise<void> {
  const debit = await tryDebitNeurons(env, cost);
  if (!debit.allowed) {
    throw new BudgetExhaustedError(
      `Daily Workers AI Neuron budget exhausted (${debit.used}/9500)`,
      debit.retryAfter
    );
  }
}

function normalizeWorkersResponse(result: unknown): string {
  if (result && typeof result === 'object') {
    const asObject = result as Record<string, unknown>;
    if (typeof asObject.response === 'string') {
      return asObject.response;
    }

    if (Array.isArray(asObject.output_text) && asObject.output_text.length > 0) {
      const [first] = asObject.output_text;
      if (typeof first === 'string') {
        return first;
      }
    }
  }

  if (typeof result === 'string') {
    return result;
  }

  throw new MalformedProviderOutputError('Workers AI returned no usable text');
}

async function callWorkersAiRest(
  accountId: string,
  token: string,
  model: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ response: string; usage?: Record<string, unknown> }> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });

  const json = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: {
      response?: string;
      usage?: Record<string, unknown>;
    };
  };

  if (!response.ok || !json.success) {
    const message =
      json.errors
        ?.map((item) => item.message)
        .filter(Boolean)
        .join('; ') || `Workers AI REST error (${response.status})`;
    throw new Error(message);
  }

  return {
    response: normalizeWorkersResponse(json.result),
    usage: json.result?.usage,
  };
}

async function callWorkersAiRestRaw(
  accountId: string,
  token: string,
  model: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: unknown;
  };

  if (!response.ok || !json.success) {
    const message =
      json.errors
        ?.map((item) => item.message)
        .filter(Boolean)
        .join('; ') || `Workers AI REST error (${response.status})`;
    throw new Error(message);
  }

  return json.result;
}

function extractWorkersAiEmbeddingRows(result: unknown): number[][] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result.filter(
      (row): row is number[] => Array.isArray(row) && row.every((item) => typeof item === 'number')
    );
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;

    if (Array.isArray(record.data) && Array.isArray(record.data[0])) {
      return (record.data as unknown[]).filter(
        (row): row is number[] =>
          Array.isArray(row) && row.every((item) => typeof item === 'number')
      );
    }

    if (Array.isArray(record.embeddings) && Array.isArray(record.embeddings[0])) {
      return (record.embeddings as unknown[]).filter(
        (row): row is number[] =>
          Array.isArray(row) && row.every((item) => typeof item === 'number')
      );
    }

    if (
      Array.isArray(record.embedding) &&
      record.embedding.every((item) => typeof item === 'number')
    ) {
      return [record.embedding as number[]];
    }
  }

  return [];
}

function buildWorkersAiCompletion(model: string, content: string, usage?: Record<string, unknown>) {
  return {
    id: `cf-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function streamRestResult(model: string, restResult: { response: string }) {
  async function* singleChunk() {
    yield { response: restResult.response };
  }
  return {
    provider: 'workers_ai' as const,
    model,
    stream: true as const,
    streamSource: singleChunk(),
  };
}

export const callWorkersAi: ProviderCaller = async (input) => {
  input.signal?.throwIfAborted();
  if (!isWorkersAiEnabled(input.env)) {
    throw new Error('Workers AI is disabled');
  }

  // Gate every Workers AI invocation through the daily Neuron budget so we
  // never exceed the 10k/day free quota.
  const outputTokens = input.max_tokens ?? DEFAULT_WORKERS_AI_OUTPUT_TOKENS;
  const cost = estimateNeuronCost(input.model, {
    inputBytes: estimateChatInputBytes(input.messages) ?? -1,
    outputTokens,
  });
  await reserveWorkersAiBudget(input.env, cost);
  input.signal?.throwIfAborted();

  const payload: Record<string, unknown> = {
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: outputTokens,
    stream: input.stream,
  };

  const hasBinding = Boolean(input.env.AI && typeof input.env.AI.run === 'function');

  if (!hasBinding) {
    const accountId = input.env.CLOUDFLARE_ACCOUNT_ID;
    const token = input.env.CLOUDFLARE_WORKERS_AI_API_KEY;

    if (!accountId || !token) {
      throw new Error(
        'Workers AI is unavailable: missing AI binding and REST fallback credentials'
      );
    }

    const restResult = await callWorkersAiRest(
      accountId,
      token,
      input.model,
      { ...payload, stream: false },
      input.signal
    );

    if (input.stream) {
      return streamRestResult(input.model, restResult);
    }

    return {
      provider: 'workers_ai',
      model: input.model,
      stream: false,
      completion: buildWorkersAiCompletion(input.model, restResult.response, restResult.usage),
    };
  }

  const result = await input.env.AI!.run(input.model, payload);
  input.signal?.throwIfAborted();

  if (input.stream) {
    if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
      return {
        provider: 'workers_ai',
        model: input.model,
        stream: true,
        streamSource: result as AsyncIterable<unknown>,
      };
    }

    throw new MalformedProviderOutputError('Workers AI stream source is not async iterable');
  }

  const content = normalizeWorkersResponse(result);

  return {
    provider: 'workers_ai',
    model: input.model,
    stream: false,
    completion: buildWorkersAiCompletion(input.model, content),
  };
};

export const callWorkersAiEmbeddings: ProviderEmbeddingCaller = async (input) => {
  if (!isWorkersAiEnabled(input.env)) {
    throw new Error('Workers AI is disabled');
  }

  const validInput =
    typeof input.input === 'string' ||
    (Array.isArray(input.input) && input.input.every((item) => typeof item === 'string'));
  const inputBytes = validInput
    ? new TextEncoder().encode(JSON.stringify(input.input)).byteLength
    : -1;
  const cost = estimateNeuronCost(input.model, { inputBytes });
  await reserveWorkersAiBudget(input.env, cost);

  const payload: Record<string, unknown> = {
    text: input.input,
  };

  let result: unknown;
  if (input.env.AI && typeof input.env.AI.run === 'function') {
    result = await input.env.AI.run(input.model, payload);
  } else {
    const accountId = input.env.CLOUDFLARE_ACCOUNT_ID;
    const token = input.env.CLOUDFLARE_WORKERS_AI_API_KEY;
    if (!accountId || !token) {
      throw new Error(
        'Workers AI embeddings unavailable: missing AI binding and REST fallback credentials'
      );
    }
    result = await callWorkersAiRestRaw(accountId, token, input.model, payload);
  }

  const rows = extractWorkersAiEmbeddingRows(result);
  if (rows.length === 0) {
    throw new MalformedProviderOutputError('Workers AI returned no embeddings');
  }

  return {
    provider: 'workers_ai',
    model: input.model,
    response: {
      object: 'list',
      data: rows.map((embedding, index) => ({
        object: 'embedding' as const,
        index,
        embedding,
      })),
      model: input.model,
    },
  };
};
