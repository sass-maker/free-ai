import type { ModelCandidate } from '../types';

// JSON mode alone does not imply schema-constrained decoding. Qualify model
// families from provider documentation; preserve normal automatic ranking.
// https://ai.google.dev/gemini-api/docs/openai#structured-output
// https://console.groq.com/docs/structured-outputs
const GROQ_SCHEMA_MODELS = new Set([
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
]);

export function supportsJsonSchema(candidate: ModelCandidate): boolean {
  if (!candidate.capabilities.jsonMode) return false;
  return (
    (candidate.provider === 'gemini' && candidate.model.startsWith('gemini-')) ||
    (candidate.provider === 'groq' && GROQ_SCHEMA_MODELS.has(candidate.model))
  );
}
