import { isWorkersAiEnabled } from '../config';
import { estimateNeuronCost, tryDebitNeurons } from '../state/neuron-budget';
import type { Env } from '../types';

export interface WorkersAiTtsInput {
  env: Env;
  model: string;
  input: string;
  voice?: string;
  response_format?: 'mp3' | 'wav' | 'opus';
  speed?: number;
}

export interface WorkersAiTtsOutput {
  audio: ArrayBuffer;
  contentType: string;
}

const VOICE_TO_LANG: Record<string, string> = {
  alloy: 'en',
  echo: 'en',
  fable: 'en',
  onyx: 'en',
  nova: 'en',
  shimmer: 'en',
  en: 'en',
  es: 'es',
  fr: 'fr',
  zh: 'zh',
  ja: 'jp',
  ko: 'kr',
};

export async function callWorkersAiTts(input: WorkersAiTtsInput): Promise<WorkersAiTtsOutput> {
  if (!isWorkersAiEnabled(input.env)) {
    throw new Error('Workers AI is disabled');
  }

  if (!input.env.AI || typeof input.env.AI.run !== 'function') {
    throw new Error('Workers AI binding not available');
  }

  const debit = await tryDebitNeurons(input.env, estimateNeuronCost(input.model));
  if (!debit.allowed) {
    throw new Error(`Daily Workers AI Neuron budget exhausted (${debit.used}/9500)`);
  }

  const lang = input.voice ? (VOICE_TO_LANG[input.voice.toLowerCase()] ?? 'en') : 'en';

  const result = (await input.env.AI.run(input.model, {
    prompt: input.input,
    lang,
  })) as unknown;

  let base64: string | undefined;

  if (result && typeof result === 'object') {
    const asObj = result as Record<string, unknown>;
    if (typeof asObj.audio === 'string') {
      base64 = asObj.audio;
    }
  }

  if (!base64) {
    throw new Error('Workers AI TTS returned no audio');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return {
    audio: bytes.buffer as ArrayBuffer,
    contentType: 'audio/mpeg',
  };
}
