import type { ChatMessage, NormalizedChatRequest } from '../types';

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function normalizeMessages(
  messages: ChatMessage[] | undefined,
  prompt: string | undefined
): ChatMessage[] {
  if (messages && messages.length > 0) {
    return messages;
  }

  if (!prompt) {
    return [];
  }

  return [{ role: 'user', content: prompt }];
}

export function getErrorMessage(error: unknown): string {
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

export function buildCompletionEnvelope(params: {
  model: string;
  content: string;
  requestId: string;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  gatewayMeta: unknown;
}): Record<string, unknown> {
  return {
    id: `chatcmpl-${params.requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: params.content,
        },
        finish_reason: params.finishReason ?? 'stop',
      },
    ],
    usage: params.usage,
    x_gateway: params.gatewayMeta,
  };
}

export function sanitizeOpenAIRequest(payload: NormalizedChatRequest): {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
} {
  return {
    model: payload.model,
    messages: payload.messages,
    stream: payload.stream,
    temperature: payload.temperature,
    max_tokens: payload.max_tokens,
  };
}
