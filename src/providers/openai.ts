import { runOpenAICompatibleRequest } from './openai-compatible';
import { MalformedProviderOutputError } from '../router/classify-error';
import type { ProviderCaller } from './types';

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
