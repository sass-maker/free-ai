import { estimateNeuronCost, tryDebitNeurons } from '../state/neuron-budget';
import { isWorkersAiEnabled } from '../config';
import type { Env } from '../types';

export interface WorkersAiSttInput {
  env: Env;
  model: string;
  file: File | Blob;
  language?: string;
}

export interface WorkersAiSttOutput {
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
}

export async function callWorkersAiStt(input: WorkersAiSttInput): Promise<WorkersAiSttOutput> {
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

  const buffer = await input.file.arrayBuffer();
  const audio = Array.from(new Uint8Array(buffer));

  const payload: Record<string, unknown> = { audio };
  if (input.language) {
    payload.language = input.language;
  }

  const result = (await input.env.AI.run(input.model, payload)) as {
    text?: string;
    transcription_info?: { language?: string; duration?: number };
    words?: Array<{ word: string; start: number; end: number }>;
  };

  if (!result || typeof result.text !== 'string') {
    throw new Error('Workers AI STT returned no text');
  }

  return {
    text: result.text,
    language: result.transcription_info?.language,
    duration: result.transcription_info?.duration,
    words: result.words,
  };
}
