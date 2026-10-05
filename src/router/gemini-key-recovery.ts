import { parseApiKeys, pickApiKey } from '../providers/api-key';
import type { TextProvider } from '../types';
import {
  classifyError,
  getUpstreamStatus,
  isProviderAccountFailure,
  isRetriableFailure,
} from './classify-error';

interface KeyChoice {
  apiKey?: string;
  metadata: { key_slot: number | null; key_pool_size: number | null };
}

// One pool per request; never retain credentials in module-level state.
export class GeminiKeyPool {
  private readonly raw: string | undefined;
  private readonly keys: string[];
  private readonly used = new Set<string>();

  constructor(
    raw: string | undefined,
    private readonly pinned: boolean
  ) {
    this.raw = raw;
    this.keys = [...new Set(parseApiKeys(this.raw))];
  }

  select(provider: TextProvider): KeyChoice {
    const apiKey =
      provider === 'gemini' ? pickApiKey(this.raw, this.pinned ? this.used : undefined) : undefined;
    if (apiKey) this.used.add(apiKey);
    return {
      apiKey,
      metadata: {
        key_slot: apiKey ? this.keys.indexOf(apiKey) + 1 : null,
        key_pool_size: apiKey ? this.keys.length : null,
      },
    };
  }

  canRetry(choice: KeyChoice, attempts: number, error: unknown): boolean {
    if (!this.pinned || !choice.apiKey || attempts >= 2 || this.used.size >= this.keys.length)
      return false;
    const failureClass = classifyError(error);
    return (
      isRetriableFailure(failureClass) ||
      (failureClass === 'provider_fatal' &&
        (isProviderAccountFailure(error) || getUpstreamStatus(error) === 403))
    );
  }
}

interface AttemptMeta {
  provider: TextProvider;
  model: string;
  attempt: number;
  key_slot: number | null;
  key_pool_size: number | null;
}

export function logUpstreamAccepted(meta: AttemptMeta, stream: boolean): void {
  console.info(
    JSON.stringify({ event: 'gateway.upstream_accepted', ...meta, stream_handshake: stream })
  );
}

export function logUpstreamFailure(
  meta: AttemptMeta,
  error: unknown,
  keyRetryPending: boolean
): void {
  // Never include key values, prompts, upstream bodies or error messages.
  console.warn(
    JSON.stringify({
      event: 'gateway.upstream_failed',
      ...meta,
      upstream_status: getUpstreamStatus(error) ?? null,
      failure_class: classifyError(error),
      key_retry_pending: keyRetryPending,
    })
  );
}
