import OpenAI from 'openai';
import { parseApiKeys, pickApiKey } from '../providers/api-key';
import type { TextProvider } from '../types';
import {
  classifyError,
  getUpstreamErrorStatus,
  getUpstreamStatus,
  isProviderAccountFailure,
  isRetriableFailure,
  isUpstreamKeyRejected,
  isUpstreamRegionFailure,
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
    const apiKey = provider === 'gemini' ? pickApiKey(this.raw, this.used) : undefined;
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
    if (!choice.apiKey || attempts >= 2 || this.used.size >= this.keys.length) return false;
    const failureClass = classifyError(error);
    return (
      (this.pinned && isRetriableFailure(failureClass)) ||
      (failureClass === 'provider_fatal' && isProviderAccountFailure(error))
    );
  }
}

interface AttemptMeta {
  provider: TextProvider;
  model: string;
  attempt: number;
  key_slot: number | null;
  key_pool_size: number | null;
  /** Cloudflare colo that served the request; upstream egress follows it. */
  colo?: string | null;
}

const SAFE_ERROR_CODES = new Set([
  'json_validate_failed',
  'context_length_exceeded',
  'invalid_request_error',
  'invalid_api_key',
  'permission_denied',
  'model_not_found',
  'rate_limit_exceeded',
  'quota_exceeded',
]);

function upstreamErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : null;
}

/** Coarse, prompt-free reason for provider 400s that are not caller errors. */
function upstreamErrorReason(error: unknown): string | null {
  if (isUpstreamRegionFailure(error)) return 'unsupported_location';
  if (isUpstreamKeyRejected(error)) return 'api_key_rejected';
  return null;
}

function upstreamFailureKind(error: unknown): string {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof OpenAI.APIUserAbortError) return 'cancelled';
  if (error instanceof OpenAI.APIConnectionError) return 'connection';
  return getUpstreamStatus(error) !== undefined ? 'http' : 'unknown';
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
      upstream_error_code: upstreamErrorCode(error),
      // Google's canonical status enum only (e.g. INVALID_ARGUMENT); never the message.
      upstream_error_status: getUpstreamErrorStatus(error) ?? null,
      upstream_error_reason: upstreamErrorReason(error),
      upstream_failure_kind: upstreamFailureKind(error),
      failure_class: classifyError(error),
      key_retry_pending: keyRetryPending,
    })
  );
}
