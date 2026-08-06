import { runOpenAICompatibleRequest } from './openai-compatible';
import type { ProviderCaller } from './types';

export const callModelScope: ProviderCaller = async (input) => {
  if (!input.env.MODELSCOPE_API_KEY) {
    throw new Error('MODELSCOPE_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'modelscope',
    baseURL: 'https://api-inference.modelscope.cn/v1',
    apiKey: input.env.MODELSCOPE_API_KEY,
  });
};
