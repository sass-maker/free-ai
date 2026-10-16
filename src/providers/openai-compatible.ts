import OpenAI from 'openai';

import { MalformedProviderOutputError } from '../router/classify-error';
import type { EmbeddingProvider, TextProvider } from '../types';
import type {
  ProviderCallInput,
  ProviderCallResult,
  ProviderEmbeddingInput,
  ProviderEmbeddingResult,
} from './types';

interface OpenAICompatibleConfig<TProvider extends TextProvider | EmbeddingProvider> {
  provider: TProvider;
  baseURL: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}

// https://console.groq.com/docs/api-reference
const GROQ_REASONING_MODELS = new Set([
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
]);

function reasoningOptions(input: ProviderCallInput, provider: TextProvider) {
  if (!input.reasoning_effort || input.reasoning_effort === 'auto') return {};
  const supported =
    (provider === 'gemini' && input.model === 'gemini-3.8-flash') ||
    (provider === 'groq' && GROQ_REASONING_MODELS.has(input.model));
  return supported ? { reasoning_effort: input.reasoning_effort } : {};
}

function createClient<TProvider extends TextProvider | EmbeddingProvider>(
  config: OpenAICompatibleConfig<TProvider>
): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    ...(config.fetch && { fetch: config.fetch }),
    timeout: 15_000,
    // The gateway owns retries for both chat and embeddings.
    maxRetries: 0,
  });
}

async function completeWithDeadline(
  client: OpenAI,
  body: Record<string, unknown>,
  callerSignal?: AbortSignal
): Promise<ProviderCallResult['completion']> {
  if (callerSignal?.aborted) throw new OpenAI.APIUserAbortError();
  const controller = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so our deadline remains retriable, rather than looking
      // like a caller cancellation when abort interrupts response.json().
      reject(new OpenAI.APIConnectionTimeoutError());
      controller.abort();
    }, 15_000);
  });
  try {
    // The SDK's own timeout ends at headers. Cover JSON body consumption too,
    // without applying a total-response deadline to long-lived SSE streams.
    return (await Promise.race([
      client.chat.completions.create(body as never, { maxRetries: 0, signal }),
      deadline,
    ])) as ProviderCallResult['completion'];
  } finally {
    clearTimeout(timer);
  }
}

export async function runOpenAICompatibleRequest(
  input: ProviderCallInput,
  config: OpenAICompatibleConfig<TextProvider>
): Promise<ProviderCallResult> {
  const client = createClient(config);

  // Preserve defaults for automatic effort and unqualified model families.
  const reasoning = reasoningOptions(input, config.provider);

  if (input.stream) {
    const streamBody = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.max_tokens,
      stream: true as const,
      ...reasoning,
      ...(input.tools && { tools: input.tools }),
      ...(input.tool_choice && { tool_choice: input.tool_choice }),
      ...(input.response_format && { response_format: input.response_format }),
    };

    const stream = (await client.chat.completions.create(streamBody as never, {
      maxRetries: 0,
      signal: input.signal,
    })) as unknown as AsyncIterable<unknown>;
    return {
      provider: config.provider,
      model: input.model,
      stream: true,
      streamSource: stream,
    };
  }

  const completionBody = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.max_tokens,
    stream: false as const,
    ...reasoning,
    ...(input.tools && { tools: input.tools }),
    ...(input.tool_choice && { tool_choice: input.tool_choice }),
    ...(input.response_format && { response_format: input.response_format }),
  };

  const completion = await completeWithDeadline(client, completionBody, input.signal);
  return {
    provider: config.provider,
    model: input.model,
    stream: false,
    completion,
  };
}

export async function runOpenAICompatibleEmbeddingsRequest(
  input: ProviderEmbeddingInput,
  config: OpenAICompatibleConfig<EmbeddingProvider>
): Promise<ProviderEmbeddingResult> {
  const client = createClient(config);
  const response = (await client.embeddings.create({
    model: input.model,
    input: input.input.length === 1 ? input.input[0] : input.input,
    // Forward the requested output size so Matryoshka-capable models (e.g.
    // gemini-embedding-001 via output_dimensionality) return that dimension.
    ...(typeof input.dimensions === 'number' ? { dimensions: input.dimensions } : {}),
  } as never)) as unknown as {
    object?: string;
    data?: Array<{ embedding?: number[]; index?: number }>;
    model?: string;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };

  const data = Array.isArray(response.data)
    ? response.data
        .map((item, index) => ({
          object: 'embedding' as const,
          index: typeof item.index === 'number' ? item.index : index,
          embedding: Array.isArray(item.embedding) ? item.embedding : [],
        }))
        .filter((item) => item.embedding.length > 0)
    : [];

  if (data.length === 0) {
    throw new MalformedProviderOutputError('Provider returned no embeddings');
  }

  return {
    provider: config.provider,
    model: input.model,
    response: {
      object: 'list',
      data,
      model: typeof response.model === 'string' ? response.model : input.model,
      usage: response.usage,
    },
  };
}
