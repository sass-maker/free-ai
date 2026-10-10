import type { Env } from '../types';
import { getUpstreamStatus } from '../router/classify-error';
import {
  arrayBufferToBase64,
  imageHttpError,
  parseImageDimensions,
  parseSize,
} from './image-utils';

export interface PollinationsImageInput {
  env: Env;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  response_format?: 'url' | 'b64_json';
  verify?: boolean;
}

export interface PollinationsImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
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
    if (input.verify) {
      let response: Response;
      try {
        response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        throw Object.assign(new Error('Pollinations image fetch failed'), {
          status: getUpstreamStatus(error),
        });
      }
      if (!response.ok) {
        throw Object.assign(new Error(`Pollinations image error (${response.status})`), {
          status: response.status,
        });
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
        throw new Error('Pollinations returned non-image content');
      }
      const dimensions = parseImageDimensions(await response.arrayBuffer());
      if (!dimensions) {
        throw new Error('Pollinations returned unparseable image dimensions');
      }
      if (dimensions.width < 0.9 * width || dimensions.height < 0.9 * height) {
        throw new Error(
          `Pollinations image is undersized: got ${dimensions.width}x${dimensions.height}, requested ${width}x${height}`
        );
      }
    }
    return {
      created: Math.floor(Date.now() / 1000),
      data: [{ url }],
    };
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw await imageHttpError('Pollinations', response);
  }

  const buf = await response.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);

  return {
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: b64 }],
  };
}
