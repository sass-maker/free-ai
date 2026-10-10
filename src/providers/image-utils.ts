/**
 * Shared utilities for image-generation provider adapters.
 */

/** Retain only recognized diagnostic categories, never an upstream body or credentials. */
export async function imageHttpError(provider: string, response: Response): Promise<Error> {
  const detail = (await response.text()).toLowerCase();
  const reasons = [
    'third_party_data_sharing_blocked',
    'requires third-party data sharing',
    'api_key_invalid',
    'api key not valid',
    'api key expired',
    'location is not supported',
    'safety',
    'content filter',
    'refusal',
  ].filter((reason) => detail.includes(reason));
  const error = Object.assign(
    new Error(
      `${provider} image error (${response.status})${reasons.length ? `: ${reasons.join(', ')}` : ''}`
    ),
    { status: response.status }
  );
  if (detail.includes('failed_precondition')) {
    return Object.assign(error, { error: { status: 'FAILED_PRECONDITION' } });
  }
  return error;
}

export function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function imageDimensions(width: number, height: number) {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** Read dimensions from PNG IHDR, JPEG SOF0-SOF3, or WebP VP8/VP8L/VP8X headers. */
export function parseImageDimensions(
  buffer: ArrayBuffer
): { width: number; height: number } | undefined {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length >= 33 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452 // IHDR
  ) {
    return imageDimensions(view.getUint32(16), view.getUint32(20));
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return undefined;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return undefined;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if (marker >= 0xc0 && marker <= 0xc3 && length >= 8) {
        return imageDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
  }

  if (
    bytes.length >= 20 &&
    view.getUint32(0) === 0x52494646 && // RIFF
    view.getUint32(8) === 0x57454250 // WEBP
  ) {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length) return undefined;
    for (let offset = 12; offset + 8 <= end; ) {
      const chunk = view.getUint32(offset);
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (data + length > end) return undefined;
      if (
        chunk === 0x56503820 && // VP8
        length >= 10 &&
        (bytes[data] & 1) === 0 &&
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      ) {
        return imageDimensions(
          view.getUint16(data + 6, true) & 0x3fff,
          view.getUint16(data + 8, true) & 0x3fff
        );
      }
      if (chunk === 0x5650384c && length >= 5 && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true);
        return imageDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (chunk === 0x56503858 && length >= 10) {
        return imageDimensions(
          (view.getUint32(data + 4, true) & 0xffffff) + 1,
          (view.getUint16(data + 7, true) | (bytes[data + 9] << 16)) + 1
        );
      }
      offset = data + length + (length % 2);
    }
  }
  return undefined;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
