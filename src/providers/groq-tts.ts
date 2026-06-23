import type { Env } from '../types';

export interface GroqTtsInput {
  env: Env;
  model: string;
  input: string;
  voice?: string;
  response_format?: 'mp3' | 'wav' | 'opus' | 'flac';
  speed?: number;
}

export interface GroqTtsOutput {
  audio: ArrayBuffer;
  contentType: string;
}

const VOICE_ALIASES: Record<string, string> = {
  alloy: 'Aaliyah-PlayAI',
  echo: 'Angelo-PlayAI',
  fable: 'Fritz-PlayAI',
  onyx: 'Thunder-PlayAI',
  nova: 'Nova-PlayAI',
  shimmer: 'Adelaide-PlayAI',
};

export async function callGroqTts(input: GroqTtsInput): Promise<GroqTtsOutput> {
  if (!input.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const format = input.response_format ?? 'mp3';
  const voice = input.voice
    ? (VOICE_ALIASES[input.voice.toLowerCase()] ?? input.voice)
    : 'Aaliyah-PlayAI';

  const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      input: input.input,
      voice,
      response_format: format,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq TTS error (${response.status}): ${text}`);
  }

  const audio = await response.arrayBuffer();
  const contentType =
    format === 'mp3'
      ? 'audio/mpeg'
      : format === 'wav'
        ? 'audio/wav'
        : format === 'opus'
          ? 'audio/opus'
          : 'audio/flac';

  return { audio, contentType };
}
