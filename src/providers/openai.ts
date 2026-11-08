import {
  runOpenAICompatibleEmbeddingsRequest,
  runOpenAICompatibleRequest,
} from './openai-compatible';
import { MalformedProviderOutputError } from '../router/classify-error';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';

export const callOpenAI: ProviderCaller = async (input) => {
  if (!input.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const result = await runOpenAICompatibleRequest(input, {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: input.env.OPENAI_API_KEY,
  });
  if (
    !result.stream &&
    result.completion?.choices?.some((choice) => choice.finish_reason === 'length') &&
    !result.completion?.choices?.some(
      (choice) => choice.message?.content?.trim() || choice.message?.tool_calls?.length
    )
  ) {
    throw new MalformedProviderOutputError('OpenAI returned no visible completion');
  }
  return result;
};

export const callOpenAIEmbeddings: ProviderEmbeddingCaller = async (input) => {
  if (!input.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const result = await runOpenAICompatibleEmbeddingsRequest(
    { ...input, model: input.model.replace(/^openai\//, ''), encoding_format: 'float' },
    { provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: input.env.OPENAI_API_KEY }
  );
  const dimensions = input.dimensions ?? 1536;
  if (
    result.response.data.length !== input.input.length ||
    result.response.data.some(
      (row, index) =>
        row.index !== index ||
        row.embedding.length !== dimensions ||
        row.embedding.some((value) => !Number.isFinite(value))
    )
  ) {
    throw new MalformedProviderOutputError('OpenAI returned invalid embedding vectors');
  }
  return result;
};
