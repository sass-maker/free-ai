import OpenAI from 'openai';

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
}

function createClient<TProvider extends TextProvider | EmbeddingProvider>(
  config: OpenAICompatibleConfig<TProvider>,
): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    timeout: 15_000,
  });
}

export async function runOpenAICompatibleRequest(
  input: ProviderCallInput,
  config: OpenAICompatibleConfig<TextProvider>,
): Promise<ProviderCallResult> {
  const client = createClient(config);

  if (input.stream) {
    const streamBody = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.max_tokens,
      stream: true as const,
      ...(input.tools && { tools: input.tools }),
      ...(input.tool_choice && { tool_choice: input.tool_choice }),
      ...(input.response_format && { response_format: input.response_format }),
    };

    const stream = (await client.chat.completions.create(streamBody as never)) as unknown as AsyncIterable<unknown>;
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
    ...(input.tools && { tools: input.tools }),
    ...(input.tool_choice && { tool_choice: input.tool_choice }),
    ...(input.response_format && { response_format: input.response_format }),
  };

  const completion = (await client.chat.completions.create(
    completionBody as never,
  )) as ProviderCallResult['completion'];
  return {
    provider: config.provider,
    model: input.model,
    stream: false,
    completion,
  };
}

export async function runOpenAICompatibleEmbeddingsRequest(
  input: ProviderEmbeddingInput,
  config: OpenAICompatibleConfig<EmbeddingProvider>,
): Promise<ProviderEmbeddingResult> {
  const client = createClient(config);
  const response = (await client.embeddings.create({
    model: input.model,
    input: input.input.length === 1 ? input.input[0] : input.input,
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
    throw new Error('Provider returned no embeddings');
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
