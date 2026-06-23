import type { Env } from '../types';

export interface GeminiSttInput {
  env: Env;
  model: string;
  file: File | Blob;
  language?: string;
}

export interface GeminiSttOutput {
  text: string;
  language?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function mimeTypeFor(file: File | Blob): string {
  if (file.type) return file.type;
  const name = (file as File).name?.toLowerCase() ?? '';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.ogg') || name.endsWith('.opus')) return 'audio/ogg';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.flac')) return 'audio/flac';
  if (name.endsWith('.m4a') || name.endsWith('.mp4')) return 'audio/mp4';
  return 'audio/mpeg';
}

export async function callGeminiStt(input: GeminiSttInput): Promise<GeminiSttOutput> {
  if (!input.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const buf = await input.file.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  const mime = mimeTypeFor(input.file);

  const promptText =
    input.language && input.language !== 'auto'
      ? `Transcribe this audio verbatim in ${input.language}. Return only the transcription, no commentary.`
      : 'Transcribe this audio verbatim. Return only the transcription text, no commentary.';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${input.env.GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        parts: [{ text: promptText }, { inlineData: { mimeType: mime, data: base64 } }],
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini STT error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() ?? '';
  if (!text) {
    throw new Error('Gemini STT returned empty text');
  }

  return { text, language: input.language };
}
