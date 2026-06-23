import type { Env } from '../types';

export interface TogetherImageInput {
  env: Env;
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
}

export interface TogetherImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function callTogetherImages(input: TogetherImageInput): Promise<TogetherImageOutput> {
  if (!input.env.TOGETHER_API_KEY) {
    throw new Error('TOGETHER_API_KEY is not configured');
  }

  const { width, height } = parseSize(input.size);
  const wantsBase64 = input.response_format === 'b64_json';

  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: Math.max(1, Math.min(input.n ?? 1, 4)),
    width,
    height,
    response_format: wantsBase64 ? 'base64' : 'url',
  };

  const response = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.env.TOGETHER_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Together image error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    data?: Array<{
      url?: string;
      b64_json?: string;
      base64?: string;
      image_base64?: string;
      revised_prompt?: string;
    }>;
  };

  const data = (json.data ?? []).map((item) => {
    const b64 = item.b64_json ?? item.base64 ?? item.image_base64;
    if (wantsBase64) {
      return { b64_json: b64 ?? '', revised_prompt: item.revised_prompt };
    }
    return { url: item.url, b64_json: b64, revised_prompt: item.revised_prompt };
  });

  return {
    created: Math.floor(Date.now() / 1000),
    data,
  };
}
