import type { Env } from '../types';

export interface PollinationsImageInput {
  env: Env;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  response_format?: 'url' | 'b64_json';
}

export interface PollinationsImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
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

export async function callPollinationsImages(
  input: PollinationsImageInput
): Promise<PollinationsImageOutput> {
  const { width, height } = parseSize(input.size);
  const params = new URLSearchParams({
    model: input.model,
    width: String(width),
    height: String(height),
    nologo: 'true',
    private: 'true',
    enhance: 'true',
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(input.prompt)}?${params.toString()}`;

  if (input.response_format !== 'b64_json') {
    // Return URL directly without fetching bytes.
    return {
      created: Math.floor(Date.now() / 1000),
      data: [{ url }],
    };
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Pollinations image error (${response.status})`);
  }

  const buf = await response.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);

  return {
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: b64 }],
  };
}
