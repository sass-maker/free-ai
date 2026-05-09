import type {
  AudioSttProvider,
  AudioTtsProvider,
  EmbeddingProvider,
  Env,
  ImageProvider,
  TextProvider,
  VideoProvider,
} from '../types';
import { callCerebras } from './cerebras';
import { callCohere } from './cohere';
import { callGemini, callGeminiEmbeddings } from './gemini';
import { callGeminiImages, type GeminiImageInput, type GeminiImageOutput } from './gemini-images';
import { callGeminiStt } from './gemini-stt';
import { callGithubModels } from './github';
import { callGroq } from './groq';
import { callGroqTts } from './groq-tts';
import { callMistral } from './mistral';
import { callNvidia } from './nvidia';
import { callNvidiaImages, type NvidiaImageInput, type NvidiaImageOutput } from './nvidia-images';
import { callOpenRouter } from './openrouter';
import { callPollinations } from './pollinations';
import { callPollinationsImages, type PollinationsImageInput, type PollinationsImageOutput } from './pollinations-images';
import { callSambanova } from './sambanova';
import { callTogetherImages, type TogetherImageInput, type TogetherImageOutput } from './together-images';
import { pollTogetherVideo, submitTogetherVideo } from './together-videos';
import type { ProviderCaller, ProviderEmbeddingCaller } from './types';
import { callVoyageEmbeddings } from './voyage';
import { callWorkersAi, callWorkersAiEmbeddings } from './workers-ai';
import { callWorkersAiImages, type WorkersAiImageInput, type WorkersAiImageOutput } from './workers-ai-images';
import { callWorkersAiStt } from './workers-ai-stt';
import { callWorkersAiTts } from './workers-ai-tts';

export const providerCallers: Record<TextProvider, ProviderCaller> = {
  workers_ai: callWorkersAi,
  groq: callGroq,
  gemini: callGemini,
  openrouter: callOpenRouter,
  cerebras: callCerebras,
  sambanova: callSambanova,
  nvidia: callNvidia,
  github_models: callGithubModels,
  pollinations: callPollinations,
  cohere: callCohere,
  mistral: callMistral,
};

export const providerEmbeddingCallers: Record<EmbeddingProvider, ProviderEmbeddingCaller> = {
  workers_ai: callWorkersAiEmbeddings,
  gemini: callGeminiEmbeddings,
  voyage_ai: callVoyageEmbeddings,
};

// ── Image generation ────────────────────────────────────────────────
export interface UnifiedImageInput {
  env: Env;
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
}

export interface UnifiedImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

export const imageProviderCallers: Record<ImageProvider, (input: UnifiedImageInput) => Promise<UnifiedImageOutput>> = {
  together: (input) => callTogetherImages(input as TogetherImageInput) as Promise<TogetherImageOutput>,
  workers_ai: (input) => callWorkersAiImages(input as WorkersAiImageInput) as Promise<WorkersAiImageOutput>,
  pollinations: (input) => callPollinationsImages(input as PollinationsImageInput) as Promise<PollinationsImageOutput>,
  gemini: (input) => callGeminiImages(input as GeminiImageInput) as Promise<GeminiImageOutput>,
  nvidia: (input) => callNvidiaImages(input as NvidiaImageInput) as Promise<NvidiaImageOutput>,
};

// ── Video generation ────────────────────────────────────────────────
export const videoProviderCallers: Record<
  VideoProvider,
  { submit: typeof submitTogetherVideo; poll: typeof pollTogetherVideo }
> = {
  together: { submit: submitTogetherVideo, poll: pollTogetherVideo },
};

// ── TTS ──────────────────────────────────────────────────────────────
export interface UnifiedTtsInput {
  env: Env;
  model: string;
  input: string;
  voice?: string;
  response_format?: 'mp3' | 'wav' | 'opus' | 'flac';
  speed?: number;
}

export interface UnifiedTtsOutput {
  audio: ArrayBuffer;
  contentType: string;
}

export const ttsProviderCallers: Record<AudioTtsProvider, (input: UnifiedTtsInput) => Promise<UnifiedTtsOutput>> = {
  workers_ai: (input) => callWorkersAiTts({
    ...input,
    response_format: input.response_format === 'flac' ? 'mp3' : input.response_format,
  }),
  groq: (input) => callGroqTts(input),
};

// ── STT ──────────────────────────────────────────────────────────────
export interface UnifiedSttInput {
  env: Env;
  model: string;
  file: File | Blob;
  language?: string;
}

export interface UnifiedSttOutput {
  text: string;
  language?: string;
  duration?: number;
}

export const sttProviderCallers: Record<
  Exclude<AudioSttProvider, 'groq'>,
  (input: UnifiedSttInput) => Promise<UnifiedSttOutput>
> = {
  workers_ai: (input) => callWorkersAiStt(input),
  gemini: (input) => callGeminiStt(input),
};
