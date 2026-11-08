import { runOpenAICompatibleRequest } from './openai-compatible';
import type { ProviderCaller } from './types';

export const callOpenAI: ProviderCaller = async (input) => {
  if (!input.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: input.env.OPENAI_API_KEY,
  });
};
