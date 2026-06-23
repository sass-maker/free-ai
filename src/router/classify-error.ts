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

export function classifyError(error: unknown): FailureClass {
  const status = getStatus(error);
  const message = getMessage(error).toLowerCase();

  if (
    message.includes('safety') ||
    message.includes('content filter') ||
    message.includes('refus')
  ) {
    return 'safety_refusal';
  }

  if (
    status === 429 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    (status !== undefined && status >= 500)
  ) {
    return 'usage_retriable';
  }

  if (status === 400 || status === 404 || status === 422) {
    return 'input_nonretriable';
  }

  if (status === 401 || status === 403) {
    return 'provider_fatal';
  }

  if (
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('timeout') ||
    message.includes('overload')
  ) {
    return 'usage_retriable';
  }

  return 'provider_fatal';
}

export function isRetriableFailure(failureClass: FailureClass): boolean {
  return failureClass === 'usage_retriable';
}
