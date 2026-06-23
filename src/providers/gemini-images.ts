import type { Env } from '../types';

export interface GeminiImageInput {
  env: Env;
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
}

export interface GeminiImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

function sizeToAspect(size?: string): string {
  if (!size) return '1:1';
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return '1:1';
  const w = Number(match[1]);
  const h = Number(match[2]);
  const ratio = w / h;
  if (ratio > 1.5) return '16:9';
  if (ratio < 0.7) return '9:16';
  if (ratio > 1.1) return '4:3';
  if (ratio < 0.9) return '3:4';
  return '1:1';
}

export async function callGeminiImages(input: GeminiImageInput): Promise<GeminiImageOutput> {
  if (!input.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const n = Math.max(1, Math.min(input.n ?? 1, 4));
  const aspectRatio = sizeToAspect(input.size);

  // Imagen models use :predict; flash image uses :generateContent with responseModalities.
  const isImagen = input.model.toLowerCase().includes('imagen');

  const url = isImagen
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:predict?key=${input.env.GEMINI_API_KEY}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${input.env.GEMINI_API_KEY}`;

  const body = isImagen
    ? {
        instances: [{ prompt: input.prompt }],
        parameters: {
          sampleCount: n,
          aspectRatio,
        },
      }
    : {
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini image error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string };
        }>;
      };
    }>;
  };

  const data: GeminiImageOutput['data'] = [];

  if (json.predictions) {
    for (const pred of json.predictions) {
      const b64 = pred.bytesBase64Encoded;
      if (!b64) continue;
      if (input.response_format === 'b64_json') {
        data.push({ b64_json: b64 });
      } else {
        data.push({ url: `data:${pred.mimeType ?? 'image/png'};base64,${b64}`, b64_json: b64 });
      }
    }
  }

  if (json.candidates) {
    for (const cand of json.candidates) {
      const parts = cand.content?.parts ?? [];
      for (const part of parts) {
        const b64 = part.inlineData?.data ?? part.inline_data?.data;
        const mime = part.inlineData?.mimeType ?? 'image/png';
        if (!b64) continue;
        if (input.response_format === 'b64_json') {
          data.push({ b64_json: b64 });
        } else {
          data.push({ url: `data:${mime};base64,${b64}`, b64_json: b64 });
        }
      }
    }
  }

  if (data.length === 0) {
    throw new Error('Gemini image returned no data');
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data,
  };
}
