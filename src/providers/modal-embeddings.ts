import { MalformedProviderOutputError } from '../router/classify-error';
import type { Env } from '../types';
import type {
  ProviderEmbeddingCaller,
  ProviderEmbeddingInput,
  ProviderEmbeddingResult,
} from './types';

export const MODAL_EMBEDDING_TASKS = [
  'retrieval_query',
  'retrieval_document',
  'code_retrieval',
  'sentence_similarity',
  'classification',
  'clustering',
] as const;
export type ModalEmbeddingTask = (typeof MODAL_EMBEDDING_TASKS)[number];

export const MODAL_EMBEDDING_MODELS = [
  {
    model: 'google/embeddinggemma-2',
    dimensions: [128, 256, 512, 768],
    maxTokens: 2048,
    url: 'https://sarthakagrawal927--embedding-model-trial-embeddinggemma2-web.modal.run/v1/embeddings',
    tasks: [...MODAL_EMBEDDING_TASKS],
  },
  {
    model: 'BAAI/bge-small-en-v1.5',
    dimensions: [384],
    maxTokens: 512,
    url: 'https://sarthakagrawal927--embedding-model-trial-bgesmall-web.modal.run/v1/embeddings',
    tasks: ['retrieval_query', 'retrieval_document', 'sentence_similarity'],
  },
] as const;

export function isModalEmbeddingModel(model: string): boolean {
  return MODAL_EMBEDDING_MODELS.some((candidate) => candidate.model === model);
}

export function modalEmbeddingsEnabled(env: Env): boolean {
  return Boolean(env.MODAL_PROXY_KEY?.trim() && env.MODAL_PROXY_SECRET?.trim());
}

function modalError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export function validateModalEmbeddingInput(
  input: Pick<ProviderEmbeddingInput, 'model' | 'input' | 'dimensions' | 'task'>
): void {
  const model = MODAL_EMBEDDING_MODELS.find((candidate) => candidate.model === input.model);
  if (!model) throw modalError('Unsupported Modal embedding model', 400);
  if (
    input.input.length < 1 ||
    input.input.length > 8 ||
    input.input.some((text) => !text.trim() || text.length > 16000)
  )
    throw modalError(
      'Modal embeddings require 1-8 nonblank inputs of at most 16000 characters',
      400
    );
  if (
    !(model.dimensions as readonly number[]).includes(input.dimensions ?? model.dimensions.at(-1)!)
  )
    throw modalError('Unsupported dimensions for the selected Modal embedding model', 400);
  if (!(model.tasks as readonly string[]).includes(input.task ?? 'retrieval_document'))
    throw modalError('Unsupported task for the selected Modal embedding model', 400);
}

// One global persistent bucket across both models, projects and gateway isolates.
// Failed upstream calls retain their debit. This limits demand, not account dollars.
async function reserveModalRequest(env: Env): Promise<void> {
  try {
    const namespace = env.RATE_LIMIT_DO;
    const response = await namespace
      .get(namespace.idFromName('modal-embedding-trial-v1'))
      .fetch('https://internal.local/consume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          now: Date.now(),
          cost: 1,
          capacity: 5,
          refillPerSecond: 60 / 86400,
        }),
      });
    const result = (await response.json()) as {
      allowed?: unknown;
      remaining?: unknown;
      retryAfter?: unknown;
    };
    if (
      response.status === 429 &&
      result.allowed === false &&
      Number.isSafeInteger(result.retryAfter) &&
      (result.retryAfter as number) > 0
    )
      throw modalError('Modal embedding trial allowance exhausted; retry later', 429);
    if (
      !response.ok ||
      result.allowed !== true ||
      !Number.isSafeInteger(result.remaining) ||
      (result.remaining as number) < 0 ||
      (result.remaining as number) > 4 ||
      result.retryAfter !== 0
    )
      throw modalError('Modal embedding trial admission unavailable', 503);
  } catch (error) {
    if ((error as { status?: number })?.status === 429) throw error;
    throw modalError('Modal embedding trial admission unavailable', 503);
  }
}

function parseModalEmbeddings(
  value: unknown,
  input: ProviderEmbeddingInput
): ProviderEmbeddingResult['response'] {
  const model = MODAL_EMBEDDING_MODELS.find((candidate) => candidate.model === input.model)!;
  const dimensions = input.dimensions ?? model.dimensions.at(-1)!;
  const malformed = () => new MalformedProviderOutputError('Modal returned invalid embeddings');
  if (!value || typeof value !== 'object') throw malformed();
  const body = value as {
    object?: unknown;
    model?: unknown;
    data?: Array<{ object?: unknown; index?: unknown; embedding?: unknown }>;
    usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
  };
  if (
    body.object !== 'list' ||
    body.model !== input.model ||
    !Array.isArray(body.data) ||
    body.data.length !== input.input.length
  )
    throw malformed();
  const data = body.data.map((item, index) => {
    if (
      item?.object !== 'embedding' ||
      item.index !== index ||
      !Array.isArray(item.embedding) ||
      item.embedding.length !== dimensions ||
      item.embedding.some((number) => typeof number !== 'number' || !Number.isFinite(number))
    )
      throw malformed();
    const embedding = item.embedding as number[];
    const norm = Math.sqrt(embedding.reduce((sum, number) => sum + number * number, 0));
    if (Math.abs(norm - 1) > 0.0001) throw malformed();
    return { object: 'embedding' as const, index, embedding };
  });
  if (
    !Number.isSafeInteger(body.usage?.prompt_tokens) ||
    (body.usage?.prompt_tokens as number) < 1 ||
    (body.usage?.prompt_tokens as number) > 8192 ||
    body.usage?.total_tokens !== body.usage?.prompt_tokens
  )
    throw malformed();
  return {
    object: 'list',
    model: input.model,
    data,
    usage: {
      prompt_tokens: body.usage!.prompt_tokens as number,
      total_tokens: body.usage!.total_tokens as number,
    },
  };
}

export const callModalEmbeddings: ProviderEmbeddingCaller = async (input) => {
  validateModalEmbeddingInput(input);
  if (!modalEmbeddingsEnabled(input.env))
    throw modalError('Modal embeddings are not configured', 503);
  input.signal?.throwIfAborted();
  await reserveModalRequest(input.env);
  input.signal?.throwIfAborted();
  const signal = AbortSignal.any(
    [input.signal, AbortSignal.timeout(150000)].filter((value): value is AbortSignal =>
      Boolean(value)
    )
  );
  const model = MODAL_EMBEDDING_MODELS.find((candidate) => candidate.model === input.model)!;
  let response: Response;
  try {
    response = await fetch(model.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'Modal-Key': input.env.MODAL_PROXY_KEY!,
        'Modal-Secret': input.env.MODAL_PROXY_SECRET!,
      },
      signal,
      body: JSON.stringify({
        model: input.model,
        input: input.input,
        dimensions: input.dimensions,
        encoding_format: input.encoding_format ?? 'float',
        task: input.task ?? 'retrieval_document',
      }),
    });
  } catch {
    throw modalError('Modal embedding request unavailable or timed out', 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status === 413 ? 422 : response.status >= 500 ? 502 : response.status;
    const message =
      status === 400 || status === 422
        ? 'Modal rejected embedding input; check token, dimension and task limits'
        : 'Modal embedding upstream request failed';
    throw modalError(message, status);
  }
  try {
    return {
      provider: 'modal',
      model: input.model,
      response: parseModalEmbeddings(await response.json(), input),
    };
  } catch {
    throw new MalformedProviderOutputError('Modal returned invalid embeddings');
  }
};
