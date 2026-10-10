import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseImageDimensions } from '../src/providers/image-utils';
import { callPollinationsImages } from '../src/providers/pollinations-images';
import { classifyError } from '../src/router/classify-error';
import { makeTestEnv } from './helpers/env';

function png(width = 1792, height = 1024): ArrayBuffer {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0,
    0, 0, 0, 0, 8, 2, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}

function jpeg(marker: number): ArrayBuffer {
  // APP0 followed by a filled marker prefix and a one-component SOF frame.
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    4,
    0xaa,
    0xbb,
    0xff,
    0xff,
    marker,
    0,
    11,
    8,
    4,
    0,
    7,
    0,
    1,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  ]).buffer;
}

const webpFixtures = [
  {
    name: 'VP8',
    bytes: [
      0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 10, 0, 0,
      0, 0, 0, 0, 0x9d, 1, 0x2a, 0, 0xc7, 0, 0xc4,
    ],
  },
  {
    name: 'VP8L',
    bytes: [
      0x52, 0x49, 0x46, 0x46, 18, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0,
      0, 0x2f, 0xff, 0xc6, 0xff, 0x10, 0,
    ],
  },
  {
    name: 'VP8X',
    bytes: [
      0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0,
      0, 0, 0, 0, 0, 0xff, 6, 0, 0xff, 3, 0,
    ],
  },
];

describe('parseImageDimensions', () => {
  it('reads PNG IHDR dimensions', () => {
    expect(parseImageDimensions(png())).toEqual({ width: 1792, height: 1024 });
  });

  it.each([0xc0, 0xc1, 0xc2, 0xc3])('reads JPEG SOF marker %s after metadata', (marker) => {
    expect(parseImageDimensions(jpeg(marker))).toEqual({ width: 1792, height: 1024 });
  });

  it.each(webpFixtures)('reads WebP $name dimensions', ({ bytes }) => {
    expect(parseImageDimensions(new Uint8Array(bytes).buffer)).toEqual({
      width: 1792,
      height: 1024,
    });
  });

  it('returns undefined for garbage, zero dimensions, and truncated headers', () => {
    expect(parseImageDimensions(new ArrayBuffer(0))).toBeUndefined();
    expect(parseImageDimensions(new TextEncoder().encode('not an image').buffer)).toBeUndefined();
    expect(parseImageDimensions(png(0, 1024))).toBeUndefined();
    for (const buffer of [
      png(),
      jpeg(0xc0).slice(0, 22),
      ...webpFixtures.map(({ bytes }) => new Uint8Array(bytes).buffer),
    ]) {
      for (let length = 0; length < buffer.byteLength; length++) {
        expect(parseImageDimensions(buffer.slice(0, length))).toBeUndefined();
      }
    }
  });
});

describe('callPollinationsImages verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function input() {
    const { env } = makeTestEnv();
    return { env, model: 'flux', prompt: 'a cat', size: '1792x1024', verify: true };
  }

  it('fetches the URL with GET and preserves HTTP 402', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('payment required', { status: 402 }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await expect(
      callPollinationsImages({ ...input(), response_format: 'url' })
    ).rejects.toMatchObject({
      status: 402,
      message: 'Pollinations image error (402)',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://image.pollinations.ai/prompt/a%20cat?'),
      { method: 'GET', signal: expect.any(AbortSignal) }
    );
    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it('preserves HTTP status even if the error response body cannot be read', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('body unavailable'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 402 }));
    await expect(callPollinationsImages(input())).rejects.toMatchObject({ status: 402 });
  });

  it.each([
    Object.assign(new Error('fetch failed'), { status: 402 }),
    Object.assign(new Error('fetch failed'), { response: { status: 503 } }),
    new TypeError('network failure'),
  ])('wraps fetch failures and preserves any upstream status', async (upstreamError) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(upstreamError);
    const error = await callPollinationsImages(input()).catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: 'Pollinations image fetch failed' });
    expect(error).toHaveProperty(
      'status',
      (upstreamError as { status?: number; response?: { status: number } }).status ??
        (upstreamError as { response?: { status: number } }).response?.status
    );
  });

  it.each(['text/html', 'application/json', null])(
    'rejects non-image content-type %s',
    async (contentType) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new TextEncoder().encode('<html>error</html>'), {
          headers: contentType ? { 'content-type': contentType } : {},
        })
      );
      const error = await callPollinationsImages(input()).catch((failure: Error) => failure);
      expect(error).toMatchObject({ message: 'Pollinations returned non-image content' });
      expect(error).not.toHaveProperty('status');
      expect(classifyError(error)).toBe('provider_fatal');
    }
  );

  it('rejects unparseable image bytes as provider_fatal without a status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('garbage', { headers: { 'content-type': 'image/png' } })
    );
    const error = await callPollinationsImages(input()).catch((failure: Error) => failure);
    expect(error).toMatchObject({ message: 'Pollinations returned unparseable image dimensions' });
    expect(error).not.toHaveProperty('status');
    expect(classifyError(error)).toBe('provider_fatal');
  });

  it.each([
    [1015, 580],
    [1612, 1024],
    [1792, 921],
  ])('rejects undersized %sx%s images', async (width, height) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(png(width, height), { headers: { 'content-type': 'image/png' } })
    );
    const error = await callPollinationsImages(input()).catch((failure: Error) => failure);
    expect(error).toMatchObject({
      message: `Pollinations image is undersized: got ${width}x${height}, requested 1792x1024`,
    });
    expect(error).not.toHaveProperty('status');
    expect(classifyError(error)).toBe('provider_fatal');
  });

  it.each([
    [1792, 1024],
    [1613, 922],
  ])('returns only the original URL for usable %sx%s images', async (width, height) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(png(width, height), { headers: { 'content-type': 'image/png' } })
      );
    const result = await callPollinationsImages(input());
    expect(result.data).toEqual([{ url: fetchMock.mock.calls[0][0] }]);
    expect(result.created).toEqual(expect.any(Number));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('defaults the requested size to 1024x1024', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(png(1024, 580), { headers: { 'content-type': 'image/png' } })
    );
    await expect(callPollinationsImages({ ...input(), size: undefined })).rejects.toThrow(
      'got 1024x580, requested 1024x1024'
    );
  });

  it.each([false, undefined])(
    'returns the URL without fetching when verify is %s',
    async (verify) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const result = await callPollinationsImages({ ...input(), verify });
      expect(result.data).toEqual([
        { url: expect.stringContaining('https://image.pollinations.ai/') },
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('keeps the b64_json path unchanged even with verify enabled', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('original bytes'));
    const result = await callPollinationsImages({ ...input(), response_format: 'b64_json' });
    expect(result.data).toEqual([{ b64_json: btoa('original bytes') }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
