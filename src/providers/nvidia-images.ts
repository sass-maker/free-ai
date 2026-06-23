import type { Env } from '../types';

export interface NvidiaImageInput {
  env: Env;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  response_format?: 'url' | 'b64_json';
}

export interface NvidiaImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function callNvidiaImages(input: NvidiaImageInput): Promise<NvidiaImageOutput> {
  if (!input.env.NVIDIA_API_KEY) {
    throw new Error('NVIDIA_API_KEY is not configured');
  }

  const { width, height } = parseSize(input.size);

  // NVIDIA NIM invoke endpoint pattern: POST https://ai.api.nvidia.com/v1/genai/{model}
  // Body format varies per model; this is the common flux/SDXL shape.
  const url = `https://ai.api.nvidia.com/v1/genai/${input.model}`;

  const body: Record<string, unknown> = {
    prompt: input.prompt,
    width,
    height,
    steps: 4,
    seed: Math.floor(Math.random() * 1_000_000),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.env.NVIDIA_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NVIDIA image error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    image?: string;
    artifacts?: Array<{ base64?: string; url?: string }>;
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const data: NvidiaImageOutput['data'] = [];

  if (typeof json.image === 'string') {
    const b64 = json.image;
    if (input.response_format === 'b64_json') {
      data.push({ b64_json: b64 });
    } else {
      data.push({ url: `data:image/png;base64,${b64}`, b64_json: b64 });
    }
  }

  if (Array.isArray(json.artifacts)) {
    for (const art of json.artifacts) {
      if (art.base64) {
        if (input.response_format === 'b64_json') {
          data.push({ b64_json: art.base64 });
        } else {
          data.push({ url: `data:image/png;base64,${art.base64}`, b64_json: art.base64 });
        }
      } else if (art.url) {
        data.push({ url: art.url });
      }
    }
  }

  if (Array.isArray(json.data)) {
    for (const item of json.data) {
      if (item.b64_json) {
        data.push({
          b64_json: item.b64_json,
          url:
            input.response_format === 'b64_json'
              ? undefined
              : `data:image/png;base64,${item.b64_json}`,
        });
      } else if (item.url) {
        data.push({ url: item.url });
      }
    }
  }

  if (data.length === 0) {
    throw new Error('NVIDIA image returned no data');
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data,
  };
}
