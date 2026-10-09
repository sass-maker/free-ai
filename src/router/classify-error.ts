import type { FailureClass } from '../types';

export function getUpstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const maybeStatus = (error as { status?: unknown }).status;
  if (typeof maybeStatus === 'number') {
    return maybeStatus;
  }

  const maybeResponse = (error as { response?: { status?: unknown } }).response;
  if (maybeResponse && typeof maybeResponse.status === 'number') {
    return maybeResponse.status;
  }

  return undefined;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

/** Google's canonical status (e.g. INVALID_ARGUMENT) from an unwrapped Gemini error body. */
export function getUpstreamErrorStatus(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { error?: { status?: unknown } }).error?.status;
  return typeof status === 'string' && /^[A-Z_]{1,40}$/.test(status) ? status : undefined;
}

function getUpstreamErrorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const body = (error as { error?: unknown }).error;
  try {
    return `${getMessage(error)} ${body === undefined ? '' : JSON.stringify(body)}`.toLowerCase();
  } catch {
    return getMessage(error).toLowerCase();
  }
}

/**
 * Gemini rejects requests whose egress location is not served (for example a
 * free-tier key reached from an unsupported region) with HTTP 400
 * FAILED_PRECONDITION. Workers egress from the colo nearest the caller, so the
 * same request can fail in one colo and succeed in another. It is not a caller
 * input error and no other key on the same provider can recover it.
 */
export function isUpstreamRegionFailure(error: unknown): boolean {
  if (getUpstreamStatus(error) !== 400) return false;
  return (
    getUpstreamErrorStatus(error) === 'FAILED_PRECONDITION' ||
    getUpstreamErrorDetail(error).includes('location is not supported')
  );
}

/** Gemini reports invalid or expired API keys as HTTP 400 rather than 401/403. */
export function isUpstreamKeyRejected(error: unknown): boolean {
  if (getUpstreamStatus(error) !== 400) return false;
  const detail = getUpstreamErrorDetail(error);
  return (
    detail.includes('api_key_invalid') ||
    detail.includes('api key not valid') ||
    detail.includes('api key expired')
  );
}

const SAFETY_KEYWORDS = ['safety', 'content filter', 'refus'];
const RETRIABLE_KEYWORDS = ['rate limit', 'quota', 'timeout', 'timed out', 'overload'];
const RETRIABLE_STATUSES = new Set([429, 408, 409, 425]);
const INPUT_ERROR_STATUSES = new Set([400, 422]);
const AUTH_ERROR_STATUSES = new Set([401, 403]);

export function classifyError(error: unknown): FailureClass {
  const status = getUpstreamStatus(error);
  const message = getMessage(error).toLowerCase();

  if (SAFETY_KEYWORDS.some((keyword) => message.includes(keyword))) {
    return 'safety_refusal';
  }

  if (RETRIABLE_STATUSES.has(status ?? -1) || (status !== undefined && status >= 500)) {
    return 'usage_retriable';
  }

  // Groq uses 400 for invalid generated JSON. It is provider output, not
  // malformed caller input; allow normal fallback within the existing cap.
  if (isMalformedProviderOutput(error)) return 'provider_fatal';

  // Upstream account/egress rejections reuse 400 but are not caller errors.
  if (isUpstreamRegionFailure(error) || isUpstreamKeyRejected(error)) return 'provider_fatal';

  if (INPUT_ERROR_STATUSES.has(status ?? -1)) {
    return 'input_nonretriable';
  }

  if (AUTH_ERROR_STATUSES.has(status ?? -1)) {
    return 'provider_fatal';
  }

  if (RETRIABLE_KEYWORDS.some((keyword) => message.includes(keyword))) {
    return 'usage_retriable';
  }

  return 'provider_fatal';
}

export function isRetriableFailure(failureClass: FailureClass): boolean {
  return failureClass === 'usage_retriable';
}

/** Provider returned a 200-class response that is not usable output. */
export class MalformedProviderOutputError extends Error {
  constructor(message = 'Provider returned malformed output') {
    super(message);
    this.name = 'MalformedProviderOutputError';
  }
}

export function isMalformedProviderOutput(error: unknown): boolean {
  // A SyntaxError here is the SDK failing to JSON.parse the upstream body.
  return (
    error instanceof MalformedProviderOutputError ||
    error instanceof SyntaxError ||
    (getUpstreamStatus(error) === 400 &&
      (error as { code?: unknown })?.code === 'json_validate_failed')
  );
}

/** These statuses concern the gateway's upstream account, not the caller's credentials. */
export function isProviderAccountFailure(error: unknown): boolean {
  const status = getUpstreamStatus(error);
  return status === 401 || status === 402 || status === 403 || isUpstreamKeyRejected(error);
}

/** No further attempt on this provider can succeed within the current request. */
export function isProviderUnavailableForRequest(error: unknown): boolean {
  return isProviderAccountFailure(error) || isUpstreamRegionFailure(error);
}

/** Unavailable upstream accounts/models and malformed output may fall back; content refusals may not. */
export function canFallbackFromProviderFailure(
  error: unknown,
  failureClass: FailureClass
): boolean {
  return (
    failureClass === 'provider_fatal' &&
    (isProviderUnavailableForRequest(error) ||
      getUpstreamStatus(error) === 404 ||
      getUpstreamStatus(error) === 410 ||
      isMalformedProviderOutput(error))
  );
}
