import type { FailureClass } from '../types';

function getStatus(error: unknown): number | undefined {
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

const SAFETY_KEYWORDS = ['safety', 'content filter', 'refus'];
const RETRIABLE_KEYWORDS = ['rate limit', 'quota', 'timeout', 'overload'];
const RETRIABLE_STATUSES = new Set([429, 408, 409, 425]);
const INPUT_ERROR_STATUSES = new Set([400, 404, 422]);
const AUTH_ERROR_STATUSES = new Set([401, 403]);

export function classifyError(error: unknown): FailureClass {
  const status = getStatus(error);
  const message = getMessage(error).toLowerCase();

  if (SAFETY_KEYWORDS.some((keyword) => message.includes(keyword))) {
    return 'safety_refusal';
  }

  if (RETRIABLE_STATUSES.has(status ?? -1) || (status !== undefined && status >= 500)) {
    return 'usage_retriable';
  }

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
