import { pickApiKey } from './api-key';
import {
  runOpenAICompatibleEmbeddingsRequest,
  runOpenAICompatibleRequest,
} from './openai-compatible';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';

const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Gemini's OpenAI-compatible endpoint wraps error bodies in a JSON array
 * (`[{"error":{...}}]`). The OpenAI SDK only reads `body.error`, so every
 * Gemini failure surfaced as "400 status code (no body)" and lost its
 * canonical status (INVALID_ARGUMENT, FAILED_PRECONDITION, ...). Unwrap the
 * single-element array so the SDK error keeps Google's error object.
 */
export const geminiFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.ok) return response;
  const text = await response.text();
  let body = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      Array.isArray(parsed) &&
      parsed.length === 1 &&
      parsed[0] &&
      typeof parsed[0] === 'object'
    ) {
      body = JSON.stringify(parsed[0]);
    }
  } catch {
    // Not JSON; pass the original text through unchanged.
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

export const callGemini: ProviderCaller = async (input) => {
  const apiKey = input.apiKey ?? pickApiKey(input.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleRequest(input, {
    provider: 'gemini',
    baseURL: GEMINI_OPENAI_BASE_URL,
    apiKey,
    fetch: geminiFetch,
  });
};

export const callGeminiEmbeddings: ProviderEmbeddingCaller = async (input) => {
  const apiKey = pickApiKey(input.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return runOpenAICompatibleEmbeddingsRequest(input, {
    provider: 'gemini',
    baseURL: GEMINI_OPENAI_BASE_URL,
    apiKey,
    fetch: geminiFetch,
  });
};
