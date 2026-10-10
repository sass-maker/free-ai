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
