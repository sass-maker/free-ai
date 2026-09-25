import { pickApiKey } from './api-key';
import {
  runOpenAICompatibleEmbeddingsRequest,
  runOpenAICompatibleRequest,
} from './openai-compatible';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';

export const callGemini: ProviderCaller = async (input) => {
  const apiKey = pickApiKey(input.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey,
  });
};

export const callGeminiEmbeddings: ProviderEmbeddingCaller = async (input) => {
  const apiKey = pickApiKey(input.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleEmbeddingsRequest(input, {
    provider: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey,
  });
};
