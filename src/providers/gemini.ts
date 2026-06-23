import {
  runOpenAICompatibleEmbeddingsRequest,
  runOpenAICompatibleRequest,
} from './openai-compatible';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';

export const callGemini: ProviderCaller = async (input) => {
  if (!input.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: input.env.GEMINI_API_KEY,
  });
};

export const callGeminiEmbeddings: ProviderEmbeddingCaller = async (input) => {
  if (!input.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleEmbeddingsRequest(input, {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: input.env.GEMINI_API_KEY,
  });
};
