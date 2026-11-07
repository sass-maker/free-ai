import { isWorkersAiEnabled } from '../config';
import {
  DAILY_NEURON_CAP,
  type DebitResult,
  estimateNeuronCost,
  tryDebitNeurons,
} from '../state/neuron-budget';
import type { Env } from '../types';

export const WORKERS_AI_TTS_MODEL = '@cf/deepgram/aura-2-en';

export interface WorkersAiTtsInput {
  env: Env;
  model: string;
  input: string;
  voice?: string;
  response_format?: 'mp3' | 'wav' | 'opus' | 'flac';
  speed?: number;
}

export interface WorkersAiTtsOutput {
  audio: ArrayBuffer;
  contentType: string;
}

export class TtsBudgetError extends Error {
  constructor(readonly debit: DebitResult) {
    super('Workers AI TTS budget reservation unavailable or exhausted');
  }
}

export class TtsInputError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_tts_options' | 'tts_input_too_large' = 'invalid_tts_options'
  ) {
    super(message);
  }
}

// Legacy OpenAI voice names previously all selected the same English MeloTTS voice.
// Preserve them as explicit aliases; do not claim they are distinct Aura speakers.
const LUNA_ALIASES = new Set(['luna', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

function validateTtsOptions(input: WorkersAiTtsInput): void {
  if (input.model !== WORKERS_AI_TTS_MODEL)
    throw new TtsInputError('Unsupported Workers AI TTS model');
  if (!input.input.trim()) throw new TtsInputError('TTS input must not be empty');
  if (!LUNA_ALIASES.has((input.voice ?? 'luna').toLowerCase())) {
    throw new TtsInputError('Unsupported voice: use luna or an OpenAI voice alias');
  }
  // Keep the migration limited to the documented MPEG binding output contract.
  if (input.response_format && input.response_format !== 'mp3') {
    throw new TtsInputError('Workers AI TTS currently supports only mp3');
  }
  if (input.speed !== undefined && input.speed !== 1) {
    throw new TtsInputError('Workers AI TTS does not support speed adjustment');
  }
}

export async function callWorkersAiTts(input: WorkersAiTtsInput): Promise<WorkersAiTtsOutput> {
  if (!isWorkersAiEnabled(input.env)) throw new Error('Workers AI is disabled');
  if (!input.env.AI || typeof input.env.AI.run !== 'function') {
    throw new Error('Workers AI binding not available');
  }
  validateTtsOptions(input);

  const reservation = estimateNeuronCost(input.model, {
    inputBytes: new TextEncoder().encode(input.input).byteLength,
  });
  if (reservation !== null && reservation > DAILY_NEURON_CAP) {
    throw new TtsInputError('TTS input exceeds the daily Workers AI budget', 'tts_input_too_large');
  }
  const debit = await tryDebitNeurons(input.env, reservation);
  if (!debit.allowed) throw new TtsBudgetError(debit);

  // https://developers.cloudflare.com/workers-ai/models/aura-2-en/
  const result: unknown = await input.env.AI.run(input.model, {
    text: input.input,
    speaker: 'luna',
    encoding: 'mp3',
  });
  if (!(result instanceof ReadableStream))
    throw new Error('Workers AI TTS returned no audio stream');
  const audio = await new Response(result).arrayBuffer();
  if (audio.byteLength === 0) throw new Error('Workers AI TTS returned empty audio');
  return { audio, contentType: 'audio/mpeg' };
}
