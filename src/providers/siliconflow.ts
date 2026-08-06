import { runOpenAICompatibleRequest } from './openai-compatible';
import type { ProviderCaller } from './types';

export const callSiliconFlow: ProviderCaller = async (input) => {
  if (!input.env.SILICONFLOW_API_KEY) {
    throw new Error('SILICONFLOW_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'siliconflow',
    baseURL: 'https://api.siliconflow.com/v1',
    apiKey: input.env.SILICONFLOW_API_KEY,
  });
};
