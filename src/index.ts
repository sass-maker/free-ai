import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { configurePostHog, trace, flushPostHog } from '@saas-maker/ops';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { AbortError } from 'p-retry';
import {
  getImageRegistry,
  getModelKey,
  getModelRegistry,
  getProviderLimits,
  getRateLimitConfig,
  getSttRegistry,
  getTtsRegistry,
  getVideoRegistry,
  hasImageProviderKey,
  hasSttProviderKey,
  hasTtsProviderKey,
  hasVideoProviderKey,
  isWorkersAiEnabled,
} from './config';
import {
  imageProviderCallers,
  providerCallers,
  providerEmbeddingCallers,
  sttProviderCallers,
  ttsProviderCallers,
  videoProviderCallers,
} from './providers';
import { classifyError, isRetriableFailure } from './router/classify-error';
import { deriveRequiredCapabilities, selectCandidates } from './router/select-model';
import { evaluationWeight, parseEvaluationWeights } from './router/evaluation-weights';
import { consumeIpRateLimit, healthLookup, healthRecord, healthSnapshot, nextRoundRobinOffset, providerStats } from './state/client';
import { HealthStateDO } from './state/health-do';
import { IpRateLimitDO } from './state/ip-rate-limit-do';
import { NeuronBudgetDO } from './state/neuron-budget-do';
import { buildBudgetExhaustedResponse, estimateNeuronCost, getNeuronUsage, tryDebitNeurons } from './state/neuron-budget';
import { createSseStream, toSseData } from './utils/sse';
import { buildCompletionEnvelope, createRequestId, getErrorMessage, normalizeMessages } from './utils/request';
import type {
  ChatMessage,
  EmbeddingProvider,
  Env,
  GatewayMeta,
  ModelCandidate,
  NormalizedChatRequest,
  Provider,
  ProviderLimitConfig,
  ResponseFormat,
  TextProvider,
  Tool,
  VideoProvider,
} from './types';
import { DASHBOARD_HTML } from './dashboard-html';

const app = new OpenAPIHono<{ Bindings: Env }>();

const TEXT_PROVIDER_VALUES = [
  'workers_ai',
  'groq',
  'gemini',
  'openrouter',
  'cerebras',
  'sambanova',
  'nvidia',
  'github_models',
  'pollinations',
  'cohere',
  'mistral',
] as const;

const contentPartTextSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(100_000),
});

const contentPartImageUrlSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string().min(1),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});

const contentSchema = z.union([
  z.string().min(1).max(100_000),
  z.array(z.union([contentPartTextSchema, contentPartImageUrlSchema])).min(1),
]);

const messageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: contentSchema,
    name: z.string().optional(),
  })
  .openapi('ChatMessage');

const projectIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._:-]+$/);

const toolFunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const toolSchema = z.object({
  type: z.literal('function'),
  function: toolFunctionSchema,
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
]);

const responseFormatSchema = z.object({
  type: z.enum(['text', 'json_object']),
});

const chatRequestSchema = z
  .object({
    model: z.string().default('auto'),
    messages: z.array(messageSchema).optional(),
    prompt: z.string().optional(),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).max(8192).optional(),
    reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']).default('auto'),
    min_reasoning_level: z.enum(['low', 'medium', 'high']).optional(),
    project_id: projectIdSchema.optional(),
    tools: z.array(toolSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
    response_format: responseFormatSchema.optional(),
  })
  .openapi('ChatCompletionRequest');

const responsesRequestSchema = z
  .object({
    model: z.string().default('auto'),
    input: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_output_tokens: z.number().int().min(1).max(8192).optional(),
    reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']).optional(),
    min_reasoning_level: z.enum(['low', 'medium', 'high']).optional(),
    reasoning: z
      .object({
        effort: z.enum(['low', 'medium', 'high']).optional(),
      })
      .optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('ResponsesRequest');

const embeddingsRequestSchema = z
  .object({
    model: z.string().min(1),
    input: z.union([z.string(), z.array(z.string().min(1)).min(1)]),
    encoding_format: z.enum(['float']).optional(),
    dimensions: z.number().int().min(1).max(4096).optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('EmbeddingsRequest');

const gatewayMetaSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    attempts: z.number().int().min(1),
    reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']),
    request_id: z.string(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('GatewayMeta');

const nonStreamResponseSchema = z
  .object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(
      z.object({
        index: z.number(),
        message: z.object({
          role: z.string(),
          content: z.string().nullable(),
        }),
        finish_reason: z.string().nullable(),
      }),
    ),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
    x_gateway: gatewayMetaSchema,
  })
  .openapi('ChatCompletionResponse');

const responsesApiResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal('response'),
    created_at: z.number(),
    status: z.string(),
    model: z.string(),
    output: z.array(
      z.object({
        type: z.literal('message'),
        id: z.string(),
        status: z.string(),
        role: z.literal('assistant'),
        content: z.array(
          z.object({
            type: z.literal('output_text'),
            text: z.string(),
            annotations: z.array(z.unknown()),
          }),
        ),
      }),
    ),
    output_text: z.string(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
    x_gateway: gatewayMetaSchema.optional(),
  })
  .openapi('ResponsesResponse');

const embeddingsResponseSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(
      z.object({
        object: z.literal('embedding'),
        index: z.number(),
        embedding: z.array(z.number()),
      }),
    ),
    model: z.string(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .optional(),
    x_gateway: gatewayMetaSchema,
  })
  .openapi('EmbeddingsResponse');

const errorSchema = z
  .object({
    error: z.object({
      message: z.string(),
      type: z.string(),
      code: z.string().optional(),
    }),
  })
  .openapi('ErrorResponse');

const modelItemSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  reasoning: z.string(),
  supports_streaming: z.boolean(),
  cooldown_until: z.number(),
  success_rate: z.number(),
  headroom: z.number(),
  evaluation_weight: z.number(),
  evaluation_sample_count: z.number(),
  evaluated_at: z.string().nullable(),
  enabled: z.boolean(),
});

const healthSchema = z.object({
  ok: z.boolean(),
  models: z.array(
    z.object({
      key: z.string(),
      attempts: z.number(),
      success_rate: z.number(),
      avg_latency_ms: z.number(),
      cooldown_until: z.number(),
      headroom: z.number(),
      daily_used: z.number(),
      daily_limit: z.number(),
    }),
  ),
});

const analyticsBreakdownSchema = z.object({
  requests: z.number(),
  successful: z.number(),
  failed: z.number(),
});

const analyticsResponseSchema = z.object({
  total_requests: z.number(),
  successful_requests: z.number(),
  failed_requests: z.number(),
  success_rate: z.number(),
  providers: z.record(z.string(), analyticsBreakdownSchema),
  models: z.record(z.string(), analyticsBreakdownSchema),
  projects: z.record(z.string(), analyticsBreakdownSchema),
  daily: z.array(
    z.object({
      date: z.string(),
      requests: z.number(),
      successful: z.number(),
      failed: z.number(),
    }),
  ),
});

const replayRequestSchema = chatRequestSchema
  .extend({
    provider: z.enum(TEXT_PROVIDER_VALUES).optional(),
    include_completion: z.boolean().default(true),
  })
  .openapi('ReplayRequest');

const replayResponseSchema = z
  .object({
    ok: z.boolean(),
    request_id: z.string(),
    provider: z.string(),
    model: z.string(),
    latency_ms: z.number(),
    selected: z.object({
      id: z.string(),
      provider: z.string(),
      model: z.string(),
      reasoning: z.string(),
      supports_streaming: z.boolean(),
    }),
    completion: z.record(z.string(), z.unknown()).optional(),
    error: z
      .object({
        message: z.string(),
        type: z.string(),
      })
      .optional(),
  })
  .openapi('ReplayResponse');

interface EmbeddingCandidate {
  provider: EmbeddingProvider;
  model: string;
  priority: number;
}

const EMBEDDING_CANDIDATES: EmbeddingCandidate[] = [
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    priority: 0.95,
  },
  {
    provider: 'voyage_ai',
    model: 'voyage-3.5-lite',
    priority: 0.91,
  },
  {
    provider: 'voyage_ai',
    model: 'voyage-3-lite',
    priority: 0.88,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-large-en-v1.5',
    priority: 0.87,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-base-en-v1.5',
    priority: 0.85,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-small-en-v1.5',
    priority: 0.80,
  },
];

const EMBEDDING_MODEL_ALIASES: Record<string, string> = {
  'text-embedding-3-small': 'gemini-embedding-001',
  'text-embedding-3-large': 'gemini-embedding-001',
  'text-embedding-004': 'gemini-embedding-001',
};

// Paths exempt from IP rate limiting — public read-only endpoints
const RATE_LIMIT_EXEMPT_GET = new Set([
  '/v1/analytics',
  '/v1/stats/providers',
  '/v1/models',
  '/v1/dashboard',
]);

// PostHog tracing middleware
let phConfigured = false;
app.use('*', async (c, next) => {
  if (!phConfigured && c.env.POSTHOG_API_KEY) {
    configurePostHog(c.env.POSTHOG_API_KEY, 'https://us.i.posthog.com');
    phConfigured = true;
  }
  await next();
  if (c.env.POSTHOG_API_KEY) c.executionCtx.waitUntil(flushPostHog());
});

// ── Security headers on every response ─────────────────────────────
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
});

// ── API key authentication on all /v1 mutation endpoints ───────────
// GATEWAY_API_KEY must be set as a wrangler secret in production. Fail closed
// for token-spending routes if it is missing; otherwise a misconfigured deploy
// would silently become public.
const AUTH_EXEMPT_GET = new Set([
  '/v1/analytics',
  '/v1/stats/providers',
  '/v1/models',
  '/v1/dashboard',
  '/v1/budget',
]);

app.use('/v1/*', async (c, next) => {
  const isExemptGet = c.req.method === 'GET' && AUTH_EXEMPT_GET.has(new URL(c.req.url).pathname);

  if (!isExemptGet) {
    if (!c.env.GATEWAY_API_KEY) {
      return c.json(
        { error: { message: 'Gateway API key is not configured', type: 'configuration_error', code: 'auth_not_configured' } },
        503,
      );
    }

    const authHeader = c.req.header('authorization') ?? '';
    const providedKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : c.req.header('x-api-key') ?? '';

    // Constant-time comparison to prevent timing attacks
    const expected = c.env.GATEWAY_API_KEY;
    if (providedKey.length !== expected.length || !isConstantTimeEqual(providedKey, expected)) {
      return c.json(
        { error: { message: 'Unauthorized', type: 'authentication_error', code: 'invalid_api_key' } },
        401,
      );
    }
  }

  if (c.req.method === 'GET' && RATE_LIMIT_EXEMPT_GET.has(new URL(c.req.url).pathname)) {
    return next();
  }

  const config = getRateLimitConfig(c.env);
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();

  const rate = await consumeIpRateLimit(c.env, {
    ipKey: ip,
    now,
    capacity: config.capacity,
    refillPerSecond: config.refillPerSecond,
  });

  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfter));
    return c.json(
      {
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error',
        },
      },
      429,
    );
  }

  c.header('X-RateLimit-Remaining', String(rate.remaining));
  await next();
});

function getForcedTextProvider(c: { req: { header: (key: string) => string | undefined } }): TextProvider | undefined {
  const value = c.req.header('x-gateway-force-provider');
  if (!value) {
    return undefined;
  }

  if ((TEXT_PROVIDER_VALUES as readonly string[]).includes(value)) {
    return value as TextProvider;
  }

  return undefined;
}

function getForcedEmbeddingProvider(
  c: { req: { header: (key: string) => string | undefined } },
): EmbeddingProvider | undefined {
  const value = c.req.header('x-gateway-force-provider');
  if (!value) {
    return undefined;
  }

  if (['workers_ai', 'gemini', 'voyage_ai'].includes(value)) {
    return value as EmbeddingProvider;
  }

  return undefined;
}

function workersAiEmbeddingAvailable(env: Env): boolean {
  if (!isWorkersAiEnabled(env)) {
    return false;
  }

  if (env.AI && typeof env.AI.run === 'function') {
    return true;
  }

  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY);
}

function normalizeEmbeddingInput(input: string | string[]): string[] {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((value) => value.trim()).filter((value) => value.length > 0);
}

function resolveEmbeddingCandidates(
  env: Env,
  params: {
    requestedModel: string;
    forcedProvider?: EmbeddingProvider;
    forcedModel?: string;
  },
): EmbeddingCandidate[] {
  const requestedModel = params.requestedModel.trim();
  const alias = EMBEDDING_MODEL_ALIASES[requestedModel];
  const preferredModel = alias ?? requestedModel;

  const filtered = EMBEDDING_CANDIDATES.filter((candidate) => {
    if (params.forcedProvider && candidate.provider !== params.forcedProvider) {
      return false;
    }

    if (params.forcedModel && candidate.model !== params.forcedModel) {
      return false;
    }

    if (candidate.provider === 'gemini' && !env.GEMINI_API_KEY) {
      return false;
    }

    if (candidate.provider === 'workers_ai' && !workersAiEmbeddingAvailable(env)) {
      return false;
    }

    if (candidate.provider === 'voyage_ai' && !env.VOYAGE_API_KEY) {
      return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const aPreferred = preferredModel !== 'auto' && a.model === preferredModel;
    const bPreferred = preferredModel !== 'auto' && b.model === preferredModel;

    if (aPreferred && !bPreferred) {
      return -1;
    }
    if (!aPreferred && bPreferred) {
      return 1;
    }

    return b.priority - a.priority;
  });
}

function rotateByOffset<T>(items: T[], offset: number): T[] {
  if (items.length <= 1) {
    return items;
  }

  const safeOffset = ((Math.floor(offset) % items.length) + items.length) % items.length;
  if (safeOffset === 0) {
    return items;
  }

  return [...items.slice(safeOffset), ...items.slice(0, safeOffset)];
}

function buildChatRoundRobinKey(params: {
  endpoint: 'chat.completions' | 'responses';
  min_reasoning_level?: NormalizedChatRequest['min_reasoning_level'];
  stream: boolean;
  candidates: ModelCandidate[];
}): string {
  const providerSet = params.candidates.map((candidate) => getModelKey(candidate.provider, candidate.model)).join(',');
  return `chat:${params.endpoint}:${params.min_reasoning_level ?? 'auto'}:${params.stream ? 'stream' : 'nonstream'}:${providerSet}`;
}

/** Constant-time string comparison — prevents timing oracle on API key checks. */
function isConstantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function isSafetyRefusal(completion: Record<string, unknown> | undefined): boolean {
  const choice = Array.isArray(completion?.choices)
    ? (completion.choices[0] as { finish_reason?: string; message?: { content?: string | null } } | undefined)
    : undefined;

  if (!choice) {
    return false;
  }

  const finishReason = choice.finish_reason?.toLowerCase() ?? '';
  if (finishReason.includes('content_filter') || finishReason.includes('safety')) {
    return true;
  }

  const content = choice.message?.content?.toLowerCase() ?? '';
  if (content.includes('cannot help with') || content.includes('safety policy')) {
    return true;
  }

  return false;
}

function buildGatewayMeta(params: {
  provider: Provider;
  model: string;
  attempts: number;
  reasoning: NormalizedChatRequest['reasoning_effort'];
  requestId: string;
  projectId?: string;
}): GatewayMeta {
  return {
    provider: params.provider,
    model: params.model,
    attempts: params.attempts,
    reasoning_effort: params.reasoning,
    request_id: params.requestId,
    project_id: params.projectId,
  };
}

function resolveProjectId(headerValue: string | undefined, bodyValue: string | undefined): string | undefined {
  const candidate = (headerValue ?? bodyValue)?.trim();
  if (!candidate) {
    return undefined;
  }

  return projectIdSchema.safeParse(candidate).success ? candidate : undefined;
}

async function recordAnalytics(params: {
  db: D1Database;
  projectId?: string;
  outcome: 'ok' | 'error';
  provider?: Provider;
  model?: string;
}) {
  if (!params.projectId || !params.provider || !params.model) return;

  try {
    const date = new Date().toISOString().slice(0, 10);
    const isOk = params.outcome === 'ok' ? 1 : 0;
    const isError = params.outcome === 'error' ? 1 : 0;
    
    await params.db.prepare(`
      INSERT INTO project_analytics (project_id, date, provider, model, total_requests, successful_requests, failed_requests)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(project_id, date, provider, model) DO UPDATE SET
        total_requests = total_requests + 1,
        successful_requests = successful_requests + excluded.successful_requests,
        failed_requests = failed_requests + excluded.failed_requests
    `).bind(params.projectId, date, params.provider, params.model, isOk, isError).run();
  } catch (err) {
    // Ignore analytics errors
  }
}

function gatherTextFragments(input: unknown, depth = 0): string[] {
  if (depth > 10) {
    return [];
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => gatherTextFragments(item, depth + 1));
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  const record = input as Record<string, unknown>;
  const values: unknown[] = [];

  if (typeof record.text === 'string') values.push(record.text);
  if (typeof record.input_text === 'string') values.push(record.input_text);
  if (typeof record.content === 'string') values.push(record.content);
  if (Array.isArray(record.content)) values.push(...record.content);
  if (Array.isArray(record.input)) values.push(...record.input);

  return values.flatMap((value) => gatherTextFragments(value, depth + 1));
}

function responsesInputToPrompt(input: unknown): string {
  return gatherTextFragments(input).join('\n').trim();
}

function chatCompletionToResponsesObject(completion: Record<string, unknown>): Record<string, unknown> {
  const chatId = typeof completion.id === 'string' ? completion.id : `chatcmpl-${createRequestId()}`;
  const responseId = chatId.startsWith('resp_') ? chatId : `resp_${chatId.replace(/^chatcmpl-?/, '')}`;
  const createdAt =
    typeof completion.created === 'number' ? completion.created : Math.floor(Date.now() / 1000);
  const model = typeof completion.model === 'string' ? completion.model : 'auto';

  const content = String(
    (completion.choices as Array<{ message?: { content?: unknown } }>)?.[0]?.message?.content ?? '',
  );

  const usage = completion.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output: [
      {
        type: 'message',
        id: `msg_${responseId}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content,
            annotations: [],
          },
        ],
      },
    ],
    output_text: content,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        }
      : undefined,
    x_gateway: completion.x_gateway,
  };
}

const chatRoute = createRoute({
  method: 'post',
  path: '/v1/chat/completions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: chatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Chat completion response',
      content: {
        'application/json': { schema: nonStreamResponseSchema },
        'text/event-stream': {
          schema: z.object({}).openapi({ description: 'SSE stream' }),
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    429: {
      description: 'Rate limited',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    503: {
      description: 'No healthy free-tier model available',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
  },
});

app.openapi(chatRoute, async (c) => {
  const requestStartedAt = Date.now();
  const body = c.req.valid('json');
  const requestId = createRequestId();
  const endpoint = c.req.header('x-gateway-source-endpoint') === 'responses' ? 'responses' : 'chat.completions';
  const normalizedMessages = normalizeMessages(body.messages, body.prompt);
  const messageCount = normalizedMessages.length;
  const promptChars = normalizedMessages.reduce((sum, message) => {
    if (typeof message.content === 'string') {
      return sum + message.content.length;
    }
    return sum + JSON.stringify(message.content).length;
  }, 0);

  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const explicitProjectId = resolveProjectId(headerProjectId, body.project_id);
  if (!explicitProjectId) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
          type: 'invalid_request_error',
          code: 'invalid_project_id',
        },
      },
      400,
    );
  }

  const projectId = explicitProjectId;

  if (normalizedMessages.length === 0) {
    return c.json(
      {
        error: {
          message: 'Either `messages` or `prompt` is required',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      },
      400,
    );
  }

  const normalized: NormalizedChatRequest = {
    model: body.model,
    messages: normalizedMessages,
    stream: body.stream,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    reasoning_effort: body.reasoning_effort,
    min_reasoning_level: body.min_reasoning_level ?? (body.reasoning_effort === 'auto' ? undefined : body.reasoning_effort),
    tools: body.tools as Tool[] | undefined,
    tool_choice: body.tool_choice as NormalizedChatRequest['tool_choice'],
    response_format: body.response_format as ResponseFormat | undefined,
  };

  const forcedProvider = getForcedTextProvider(c);
  const forcedModel = c.req.header('x-gateway-force-model') ?? undefined;

  let registry = getModelRegistry(c.env);
  if (forcedProvider) {
    registry = registry.filter((model) => model.provider === forcedProvider);
  }

  if (registry.length === 0) {
    return c.json(
      {
        error: {
          message: 'No provider credentials or models configured',
          type: 'configuration_error',
        },
      },
      503,
    );
  }

  const limits = getProviderLimits(c.env);
  const now = Date.now();
  const modelKeys = registry.map((candidate) => getModelKey(candidate.provider, candidate.model));

  const lookupLimits: Record<string, ProviderLimitConfig> = {};
  for (const candidate of registry) {
    const key = getModelKey(candidate.provider, candidate.model);
    lookupLimits[key] = limits[key] ?? { requestsPerDay: 200 };
  }

  const stateMap = await healthLookup(c.env, modelKeys, lookupLimits, now);
  const evaluationMap = parseEvaluationWeights(c.env.MODEL_EVALUATIONS_JSON);
  const requiredCapabilities = deriveRequiredCapabilities({
    tools: normalized.tools,
    response_format: normalized.response_format,
    messages: normalized.messages,
  });

  let selected = await trace('ai:route', () => Promise.resolve(selectCandidates(registry, stateMap, {
    min_reasoning_level: normalized.min_reasoning_level,
    stream: normalized.stream,
    now,
    modelOverride: forcedModel,
    requiredCapabilities,
    evaluationMap,
  })), { context: { project: projectId, model: normalized.model } });

  const requestedModel = normalized.model.trim().toLowerCase();
  const shouldRoundRobin =
    !forcedProvider && !forcedModel && selected.length > 1 && (requestedModel === '' || requestedModel === 'auto');

  if (shouldRoundRobin) {
    const roundRobinKey = buildChatRoundRobinKey({
      endpoint,
      min_reasoning_level: normalized.min_reasoning_level,
      stream: normalized.stream,
      candidates: selected,
    });

    const offset = await nextRoundRobinOffset(c.env, {
      key: roundRobinKey,
      size: selected.length,
    }).catch(() => 0);

    selected = rotateByOffset(selected, offset);
  }

  if (selected.length === 0) {
    c.executionCtx.waitUntil(
      recordAnalytics({
        db: c.env.GATEWAY_DB,
        projectId,
        outcome: 'error',
      })
    );

    return c.json(
      {
        error: {
          message: 'No healthy free-tier model available',
          type: 'service_unavailable',
          code: 'no_candidate',
        },
      },
      503,
    );
  }

  let attemptCounter = 0;
  let chosenMeta: GatewayMeta | undefined;
  let finalResponse: Record<string, unknown> | null = null;
  let streamResponse: Response | null = null;
  let lastErrorClass = 'provider_fatal';
  let lastErrorMessage = 'Unknown error';

  await pRetry(
    async () => {
      const candidate = selected[attemptCounter];
      if (!candidate || attemptCounter >= 2) {
        throw new AbortError('No more candidates');
      }

      attemptCounter += 1;
      const startedAt = Date.now();

      try {
        const caller = providerCallers[candidate.provider];
        if (!caller) {
          throw new Error(`No caller for provider ${candidate.provider}`);
        }

        const providerResult = await caller({
          env: c.env,
          provider: candidate.provider,
          model: candidate.model,
          messages: normalized.messages,
          temperature: normalized.temperature,
          max_tokens: normalized.max_tokens,
          stream: normalized.stream,
          tools: normalized.tools,
          tool_choice: normalized.tool_choice,
          response_format: normalized.response_format,
        });

        const latencyMs = Date.now() - startedAt;
        const key = getModelKey(candidate.provider, candidate.model);

        await healthRecord(c.env, {
          key,
          success: true,
          latencyMs,
          now: Date.now(),
        });

        chosenMeta = buildGatewayMeta({
          provider: candidate.provider,
          model: candidate.model,
          attempts: attemptCounter,
          reasoning: normalized.reasoning_effort,
          requestId,
          projectId,
        });

        if (providerResult.stream && providerResult.streamSource) {
          const chunkDecoder = new TextDecoder();
          let workersSseBuffer = '';

          const writeWorkersChunk = async (writer: WritableStreamDefaultWriter<Uint8Array>, token: string) => {
            await writer.write(
              toSseData({
                id: `chatcmpl-${requestId}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: candidate.model,
                choices: [
                  {
                    index: 0,
                    delta: { content: token },
                    finish_reason: null,
                  },
                ],
              }),
            );
          };

          const processWorkersSseText = async (
            writer: WritableStreamDefaultWriter<Uint8Array>,
            text: string,
          ) => {
            workersSseBuffer += text;

            while (true) {
              const frameEnd = workersSseBuffer.indexOf('\n\n');
              if (frameEnd === -1) {
                break;
              }

              const frame = workersSseBuffer.slice(0, frameEnd).trim();
              workersSseBuffer = workersSseBuffer.slice(frameEnd + 2);
              if (!frame) {
                continue;
              }

              const dataLine = frame
                .split('\n')
                .find((line) => line.trimStart().startsWith('data:'));

              if (!dataLine) {
                continue;
              }

              const payloadText = dataLine.replace(/^data:\s*/, '').trim();
              if (!payloadText || payloadText === '[DONE]') {
                continue;
              }

              try {
                const payload = JSON.parse(payloadText) as {
                  response?: unknown;
                  delta?: { content?: unknown };
                  text?: unknown;
                };

                const token =
                  typeof payload.response === 'string'
                    ? payload.response
                    : typeof payload.delta?.content === 'string'
                      ? payload.delta.content
                      : typeof payload.text === 'string'
                        ? payload.text
                        : '';

                if (token) {
                  await writeWorkersChunk(writer, token);
                }
              } catch {
                // Ignore non-JSON frames from upstream Workers AI stream.
              }
            }
          };

          const stream = createSseStream(async (writer) => {
            for await (const chunk of providerResult.streamSource as AsyncIterable<unknown>) {
              if (candidate.provider === 'workers_ai') {
                if (chunk instanceof Uint8Array) {
                  const asText = chunkDecoder.decode(chunk, { stream: true });
                  await processWorkersSseText(writer, asText);
                  continue;
                }

                if (chunk instanceof ArrayBuffer) {
                  const bytes = new Uint8Array(chunk);
                  const asText = chunkDecoder.decode(bytes, { stream: true });
                  await processWorkersSseText(writer, asText);
                  continue;
                }

                const token =
                  typeof chunk === 'string'
                    ? chunk
                    : chunk && typeof chunk === 'object' && 'response' in chunk
                      ? String((chunk as { response?: unknown }).response ?? '')
                      : chunk &&
                          typeof chunk === 'object' &&
                          'delta' in chunk &&
                          (chunk as { delta?: { content?: unknown } }).delta?.content
                        ? String((chunk as { delta?: { content?: unknown } }).delta?.content ?? '')
                        : chunk && typeof chunk === 'object' && 'text' in chunk
                          ? String((chunk as { text?: unknown }).text ?? '')
                      : '';

                if (!token) {
                  continue;
                }

                await writeWorkersChunk(writer, token);
              } else {
                await writer.write(toSseData(chunk));
              }
            }
          });

          streamResponse = new Response(stream, {
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-store',
              'x-gateway-provider': chosenMeta.provider,
              'x-gateway-model': chosenMeta.model,
              'x-gateway-attempts': String(chosenMeta.attempts),
              'x-gateway-request-id': chosenMeta.request_id,
            },
          });

          return;
        }

        const completion = (providerResult.completion as Record<string, unknown> | undefined) ?? {};

        if (isSafetyRefusal(completion)) {
          // Safety refusal counts as successful final response and should not trigger fallback.
        }

        finalResponse = {
          ...(completion.id ? completion : buildCompletionEnvelope({
            model: candidate.model,
            content:
              String(
                (completion.choices as Array<{ message?: { content?: unknown } }>)?.[0]?.message?.content ?? '',
              ) || '',
            requestId,
            gatewayMeta: chosenMeta,
          })),
          x_gateway: chosenMeta,
        };
      } catch (error) {
        const failureClass = classifyError(error);
        lastErrorClass = failureClass;
        lastErrorMessage = getErrorMessage(error);

        await healthRecord(c.env, {
          key: getModelKey(candidate.provider, candidate.model),
          success: false,
          latencyMs: Date.now() - startedAt,
          failureClass,
          now: Date.now(),
        });

        if (!isRetriableFailure(failureClass) || attemptCounter >= 2) {
          throw new AbortError(lastErrorMessage);
        }

        throw error instanceof Error ? error : new Error(lastErrorMessage);
      }
    },
    {
      retries: 1,
      minTimeout: 10,
      factor: 1,
    },
  ).catch(() => undefined);

  if (streamResponse) {
    c.executionCtx.waitUntil(
      recordAnalytics({
        db: c.env.GATEWAY_DB,
        projectId,
        outcome: 'ok',
        provider: chosenMeta?.provider,
        model: chosenMeta?.model,
      })
    );

    return streamResponse;
  }

  if (finalResponse && chosenMeta) {
    c.executionCtx.waitUntil(
      recordAnalytics({
        db: c.env.GATEWAY_DB,
        projectId,
        outcome: 'ok',
        provider: chosenMeta.provider,
        model: chosenMeta.model,
      })
    );

    return c.json(finalResponse as never, 200);
  }

  const status = lastErrorClass === 'input_nonretriable' ? 400 : lastErrorClass === 'usage_retriable' ? 429 : 502;

  c.executionCtx.waitUntil(
    recordAnalytics({
      db: c.env.GATEWAY_DB,
      projectId,
      outcome: 'error',
      provider: chosenMeta?.provider,
      model: chosenMeta?.model,
    })
  );

  return c.json(
    {
      error: {
        message: `All providers failed: ${lastErrorMessage}`,
        type: lastErrorClass,
      },
    },
    status,
  );
});

const replayRoute = createRoute({
  method: 'post',
  path: '/v1/debug/replay',
  request: {
    body: {
      content: {
        'application/json': {
          schema: replayRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Direct provider replay result for debugging',
      content: {
        'application/json': { schema: replayResponseSchema },
      },
    },
    400: {
      description: 'Invalid replay request',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    502: {
      description: 'Provider replay failed',
      content: {
        'application/json': { schema: replayResponseSchema },
      },
    },
    503: {
      description: 'No matching provider/model configured',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
  },
});

app.openapi(replayRoute, async (c) => {
  const body = c.req.valid('json');
  const requestId = createRequestId();
  const provider = body.provider ?? getForcedTextProvider(c);

  if (!provider) {
    return c.json(
      {
        error: {
          message: 'Replay requires `provider` or x-gateway-force-provider',
          type: 'invalid_request_error',
          code: 'missing_provider',
        },
      },
      400,
    );
  }

  const normalizedMessages = normalizeMessages(body.messages, body.prompt);
  if (normalizedMessages.length === 0) {
    return c.json(
      {
        error: {
          message: 'Either `messages` or `prompt` is required',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      },
      400,
    );
  }

  const normalized: NormalizedChatRequest = {
    model: body.model,
    messages: normalizedMessages,
    stream: false,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    reasoning_effort: body.reasoning_effort,
    min_reasoning_level: body.min_reasoning_level ?? (body.reasoning_effort === 'auto' ? undefined : body.reasoning_effort),
    tools: body.tools as Tool[] | undefined,
    tool_choice: body.tool_choice as NormalizedChatRequest['tool_choice'],
    response_format: body.response_format as ResponseFormat | undefined,
  };

  const forcedModel = c.req.header('x-gateway-force-model') ?? (normalized.model.trim() === 'auto' ? undefined : normalized.model);
  const registry = getModelRegistry(c.env).filter((candidate) => candidate.provider === provider);
  const requiredCapabilities = deriveRequiredCapabilities({
    tools: normalized.tools,
    response_format: normalized.response_format,
    messages: normalized.messages,
  });

  const selected = selectCandidates(registry, new Map(), {
    min_reasoning_level: normalized.min_reasoning_level,
    stream: false,
    now: Date.now(),
    modelOverride: forcedModel,
    requiredCapabilities,
    evaluationMap: parseEvaluationWeights(c.env.MODEL_EVALUATIONS_JSON),
  });

  const candidate = selected[0];
  if (!candidate) {
    return c.json(
      {
        error: {
          message: 'No matching configured provider/model can replay this request',
          type: 'configuration_error',
          code: 'no_replay_candidate',
        },
      },
      503,
    );
  }

  const startedAt = Date.now();
  const selectedPayload = {
    id: candidate.id,
    provider: candidate.provider,
    model: candidate.model,
    reasoning: candidate.reasoning,
    supports_streaming: candidate.supportsStreaming,
  };

  try {
    const caller = providerCallers[candidate.provider];
    if (!caller) {
      throw new Error(`No caller for provider ${candidate.provider}`);
    }

    const providerResult = await caller({
      env: c.env,
      provider: candidate.provider,
      model: candidate.model,
      messages: normalized.messages,
      temperature: normalized.temperature,
      max_tokens: normalized.max_tokens,
      stream: false,
      tools: normalized.tools,
      tool_choice: normalized.tool_choice,
      response_format: normalized.response_format,
    });

    return c.json(
      {
        ok: true,
        request_id: requestId,
        provider: candidate.provider,
        model: candidate.model,
        latency_ms: Date.now() - startedAt,
        selected: selectedPayload,
        completion: body.include_completion === false ? undefined : (providerResult.completion ?? {}),
      },
      200,
    );
  } catch (error) {
    return c.json(
      {
        ok: false,
        request_id: requestId,
        provider: candidate.provider,
        model: candidate.model,
        latency_ms: Date.now() - startedAt,
        selected: selectedPayload,
        error: {
          message: getErrorMessage(error),
          type: classifyError(error),
        },
      },
      502,
    );
  }
});

const responsesRoute = createRoute({
  method: 'post',
  path: '/v1/responses',
  request: {
    body: {
      content: {
        'application/json': {
          schema: responsesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Responses API compatible response',
      content: {
        'application/json': {
          schema: responsesApiResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    429: {
      description: 'Rate limited',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    503: {
      description: 'No healthy free-tier model available',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
  },
});

app.openapi(responsesRoute, async (c) => {
  const body = c.req.valid('json');
  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const projectId = resolveProjectId(headerProjectId, body.project_id);
  if (!projectId) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
          type: 'invalid_request_error',
          code: 'invalid_project_id',
        },
      },
      400,
    );
  }

  if (body.stream) {
    return c.json(
      {
        error: {
          message: 'Streaming for /v1/responses is not implemented yet. Use /v1/chat/completions for streaming.',
          type: 'invalid_request_error',
          code: 'stream_not_supported',
        },
      },
      400,
    );
  }

  const prompt = responsesInputToPrompt(body.input);
  if (!prompt) {
    return c.json(
      {
        error: {
          message: '`input` must include text content',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      },
      400,
    );
  }

  const reasoningEffort = body.reasoning_effort ?? body.reasoning?.effort ?? 'auto';
  const min_reasoning_level = body.min_reasoning_level ?? (reasoningEffort === 'auto' ? undefined : reasoningEffort);

  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-gateway-source-endpoint', 'responses');

  const authorization = c.req.header('authorization');
  if (authorization) {
    headers.set('authorization', authorization);
  }

  const apiKey = c.req.header('x-api-key');
  if (apiKey) {
    headers.set('x-api-key', apiKey);
  }

  const forceProvider = c.req.header('x-gateway-force-provider');
  if (forceProvider) {
    headers.set('x-gateway-force-provider', forceProvider);
  }

  const forceModel = c.req.header('x-gateway-force-model');
  if (forceModel) {
    headers.set('x-gateway-force-model', forceModel);
  }

  if (projectId) {
    headers.set('x-gateway-project-id', projectId);
  }

  const proxiedRequest = new Request(new URL('/v1/chat/completions', c.req.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: body.model,
      prompt,
      stream: false,
      temperature: body.temperature,
      max_tokens: body.max_output_tokens,
      reasoning_effort: reasoningEffort,
      min_reasoning_level: min_reasoning_level,
      project_id: projectId,
    }),
  });

  const proxiedResponse = await app.fetch(proxiedRequest, c.env, c.executionCtx);
  const proxiedText = await proxiedResponse.text();

  if (!proxiedResponse.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(proxiedText);
    } catch {
      parsed = undefined;
    }

    if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
      return c.json(parsed as never, proxiedResponse.status as 400 | 429 | 503);
    }

    return c.json(
      {
        error: {
          message: proxiedText || 'Upstream error',
          type: 'provider_fatal',
        },
      },
      proxiedResponse.status as 400 | 429 | 503,
    );
  }

  let parsedCompletion: Record<string, unknown>;
  try {
    parsedCompletion = JSON.parse(proxiedText) as Record<string, unknown>;
  } catch {
    return c.json(
      {
        error: {
          message: 'Invalid JSON returned by chat completion route',
          type: 'provider_fatal',
        },
      },
      503,
    );
  }

  return c.json(chatCompletionToResponsesObject(parsedCompletion) as never, 200);
});

const embeddingsRoute = createRoute({
  method: 'post',
  path: '/v1/embeddings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: embeddingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Embeddings response',
      content: {
        'application/json': {
          schema: embeddingsResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    429: {
      description: 'Rate limited',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    503: {
      description: 'No embedding provider available',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
    502: {
      description: 'Provider failure',
      content: {
        'application/json': { schema: errorSchema },
      },
    },
  },
});

app.openapi(embeddingsRoute, async (c) => {
  const requestStartedAt = Date.now();
  const body = c.req.valid('json');
  const requestId = createRequestId();
  const normalizedInput = normalizeEmbeddingInput(body.input);
  const inputChars = normalizedInput.reduce((sum, item) => sum + item.length, 0);
  const requestedEmbeddingModel = body.model.trim();
  const forcedProvider = getForcedEmbeddingProvider(c);
  const forcedModel = c.req.header('x-gateway-force-model') ?? undefined;
  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const projectId = resolveProjectId(headerProjectId, body.project_id);

  if (!projectId) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
          type: 'invalid_request_error',
          code: 'invalid_project_id',
        },
      },
      400,
    );
  }

  if (!requestedEmbeddingModel || requestedEmbeddingModel.toLowerCase() === 'auto') {
    return c.json(
      {
        error: {
          message: '`model` is required for embeddings and cannot be "auto"',
          type: 'invalid_request_error',
          code: 'invalid_embedding_model',
        },
      },
      400,
    );
  }

  if (normalizedInput.length === 0) {
    return c.json(
      {
        error: {
          message: '`input` is required',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      },
      400,
    );
  }

  const candidates = resolveEmbeddingCandidates(c.env, {
    requestedModel: requestedEmbeddingModel,
    forcedProvider,
    forcedModel,
  });

  if (candidates.length === 0) {
    return c.json(
      {
        error: {
          message: 'No embedding provider is configured',
          type: 'configuration_error',
          code: 'no_embedding_provider',
        },
      },
      503,
    );
  }

  let attemptCounter = 0;
  let chosenMeta: GatewayMeta | undefined;
  let finalResponse: Record<string, unknown> | null = null;
  let lastErrorClass = 'provider_fatal';
  let lastErrorMessage = 'Unknown error';
  const maxEmbeddingAttempts = Math.max(1, candidates.length);

  await pRetry(
    async () => {
      const candidate = candidates[attemptCounter];
      if (!candidate || attemptCounter >= maxEmbeddingAttempts) {
        throw new AbortError('No more embedding candidates');
      }

      attemptCounter += 1;

      try {
        const caller = providerEmbeddingCallers[candidate.provider];
        if (!caller) {
          throw new Error(`No embedding caller for provider ${candidate.provider}`);
        }

        const result = await caller({
          env: c.env,
          provider: candidate.provider,
          model: candidate.model,
          input: normalizedInput,
          encoding_format: body.encoding_format,
          dimensions: body.dimensions,
        });

        chosenMeta = buildGatewayMeta({
          provider: candidate.provider,
          model: candidate.model,
          attempts: attemptCounter,
          reasoning: 'auto',
          requestId,
          projectId,
        });

        finalResponse = {
          ...result.response,
          x_gateway: chosenMeta,
        };
      } catch (error) {
        const failureClass = classifyError(error);
        lastErrorClass = failureClass;
        lastErrorMessage = getErrorMessage(error);

        if (!isRetriableFailure(failureClass) || attemptCounter >= maxEmbeddingAttempts) {
          throw new AbortError(lastErrorMessage);
        }

        throw error instanceof Error ? error : new Error(lastErrorMessage);
      }
    },
    {
      retries: maxEmbeddingAttempts - 1,
      minTimeout: 10,
      factor: 1,
    },
  ).catch(() => undefined);

  if (finalResponse && chosenMeta) {
    c.executionCtx.waitUntil(
      recordAnalytics({
        db: c.env.GATEWAY_DB,
        projectId,
        outcome: 'ok',
        provider: chosenMeta.provider,
        model: chosenMeta.model,
      })
    );
    return c.json(finalResponse as never, 200);
  }

  const status = lastErrorClass === 'input_nonretriable' ? 400 : lastErrorClass === 'usage_retriable' ? 429 : 502;

  c.executionCtx.waitUntil(
    recordAnalytics({
      db: c.env.GATEWAY_DB,
      projectId,
      outcome: 'error',
      provider: chosenMeta?.provider,
      model: chosenMeta?.model,
    })
  );

  return c.json(
    {
      error: {
        message: `All embedding providers failed: ${lastErrorMessage}`,
        type: lastErrorClass,
      },
    },
    status,
  );
});

// ── Speech-to-Text (health-aware routing across providers) ─────────
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — matches Groq / Whisper upstream limit

app.post('/v1/audio/transcriptions', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return c.json(
      {
        error: {
          message: '`file` is required (audio file: mp3, mp4, wav, webm, m4a)',
          type: 'invalid_request_error',
          code: 'missing_file',
        },
      },
      400,
    );
  }

  if ((file as File).size > MAX_AUDIO_BYTES) {
    return c.json(
      {
        error: {
          message: `Audio file too large (max ${MAX_AUDIO_BYTES / 1024 / 1024} MB)`,
          type: 'invalid_request_error',
          code: 'file_too_large',
        },
      },
      400,
    );
  }

  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const bodyProjectId = (formData.get('project_id') as string | null) ?? undefined;
  const projectId = resolveProjectId(headerProjectId, bodyProjectId);
  if (!projectId) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
          type: 'invalid_request_error',
          code: 'invalid_project_id',
        },
      },
      400,
    );
  }

  const requestedModel = ((formData.get('model') as string) || 'auto').trim();
  const language = (formData.get('language') as string | null) ?? undefined;
  const forcedProvider = c.req.header('x-gateway-force-provider') ?? undefined;

  const registry = getSttRegistry(c.env).filter((cand) => {
    if (forcedProvider && cand.provider !== forcedProvider) return false;
    if (requestedModel && requestedModel !== 'auto' && cand.model !== requestedModel) return false;
    return true;
  });

  if (registry.length === 0) {
    return c.json(
      {
        error: {
          message: 'Speech-to-text unavailable: no configured STT provider (need GROQ_API_KEY, GEMINI_API_KEY, or Workers AI binding)',
          type: 'configuration_error',
          code: 'no_stt_provider',
        },
      },
      503,
    );
  }

  const sorted = [...registry].sort((a, b) => b.priority - a.priority);

  let lastError = 'Unknown error';
  let chosenProvider: string | undefined;
  let chosenModel: string | undefined;

  for (const cand of sorted) {
    chosenProvider = cand.provider;
    chosenModel = cand.model;

    try {
      if (cand.provider === 'groq') {
        const groqForm = new FormData();
        groqForm.append('file', file, (file as File).name || 'audio.mp3');
        groqForm.append('model', cand.model);
        if (language) groqForm.append('language', language);

        const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.env.GROQ_API_KEY}` },
          body: groqForm,
        });

        if (!groqResponse.ok) {
          // Consume body to avoid response leak; do not forward upstream details to caller
          await groqResponse.body?.cancel();
          lastError = `Groq STT error (${groqResponse.status})`;
          continue;
        }

        const result = (await groqResponse.json()) as Record<string, unknown>;
        c.executionCtx.waitUntil(
          recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'ok', provider: 'groq', model: cand.model }),
        );
        return c.json(
          {
            ...result,
            x_gateway: { provider: 'groq', model: cand.model, attempts: 1, reasoning_effort: 'auto' as const, request_id: createRequestId(), project_id: projectId },
          } as never,
          200,
        );
      }

      const caller = sttProviderCallers[cand.provider as 'workers_ai' | 'gemini'];
      const result = await caller({
        env: c.env,
        model: cand.model,
        file: file as File,
        language,
      });

      c.executionCtx.waitUntil(
        recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'ok', provider: cand.provider, model: cand.model }),
      );

      return c.json(
        {
          text: result.text,
          language: result.language,
          duration: result.duration,
          x_gateway: { provider: cand.provider, model: cand.model, attempts: 1, reasoning_effort: 'auto' as const, request_id: createRequestId(), project_id: projectId },
        } as never,
        200,
      );
    } catch (err) {
      lastError = getErrorMessage(err);
      continue;
    }
  }

  c.executionCtx.waitUntil(
    recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'error', provider: chosenProvider as Provider | undefined, model: chosenModel }),
  );
  return c.json(
    { error: { message: `All STT providers failed: ${lastError}`, type: 'provider_error' } },
    502,
  );
});

// ── Speech-to-Speech (STT → LLM → TTS pipeline) ────────────────────
app.post('/v1/audio/speech-to-speech', async (c) => {
  if (!c.env.GROQ_API_KEY) {
    return c.json(
      { error: { message: 'Speech-to-speech requires GROQ_API_KEY', type: 'configuration_error' } },
      503,
    );
  }

  const formData = await c.req.formData();
  const file = formData.get('file');

  if (!file || typeof file === 'string') {
    return c.json(
      {
        error: {
          message: '`file` is required (audio file: mp3, mp4, wav, webm, m4a)',
          type: 'invalid_request_error',
          code: 'missing_file',
        },
      },
      400,
    );
  }

  if ((file as File).size > MAX_AUDIO_BYTES) {
    return c.json(
      {
        error: {
          message: `Audio file too large (max ${MAX_AUDIO_BYTES / 1024 / 1024} MB)`,
          type: 'invalid_request_error',
          code: 'file_too_large',
        },
      },
      400,
    );
  }

  const voice = (formData.get('voice') as string) || 'en-US-AriaNeural';
  const systemPrompt = formData.get('system_prompt') as string | null;

  // Step 1: Speech-to-Text via Groq Whisper
  const sttForm = new FormData();
  sttForm.append('file', file, (file as File).name || 'audio.mp3');
  sttForm.append('model', 'whisper-large-v3-turbo');

  const sttResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.GROQ_API_KEY}` },
    body: sttForm,
  });

  if (!sttResponse.ok) {
    // Do not forward raw upstream error body — it may contain provider internals
    return c.json(
      { error: { message: `STT failed (provider error ${sttResponse.status})`, type: 'provider_error', code: 'stt_failed' } },
      502,
    );
  }

  const sttResult = (await sttResponse.json()) as { text: string };
  const transcribedText = sttResult.text;

  if (!transcribedText?.trim()) {
    return c.json(
      { error: { message: 'No speech detected in audio', type: 'invalid_request_error', code: 'no_speech' } },
      400,
    );
  }

  // Step 2: LLM response via gateway providers (Groq primary, Gemini fallback)
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: transcribedText });

  let llmText: string;
  try {
    const llmResult = await providerCallers.groq({
      env: c.env,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      messages,
      stream: false,
    });
    llmText = llmResult.completion?.choices?.[0]?.message?.content || '';
  } catch {
    try {
      const llmResult = await providerCallers.gemini({
        env: c.env,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        messages,
        stream: false,
      });
      llmText = llmResult.completion?.choices?.[0]?.message?.content || '';
    } catch (fallbackErr) {
      return c.json(
        { error: { message: `LLM failed: ${getErrorMessage(fallbackErr)}`, type: 'provider_error', code: 'llm_failed' } },
        502,
      );
    }
  }

  if (!llmText?.trim()) {
    return c.json(
      { error: { message: 'LLM returned empty response', type: 'provider_error', code: 'empty_llm_response' } },
      502,
    );
  }

  // Step 3: Text-to-Speech via Workers AI
  if (!isWorkersAiEnabled(c.env) || !c.env.AI) {
    return c.json(
      { error: { message: 'TTS requires Workers AI to be explicitly enabled', type: 'configuration_error' } },
      503,
    );
  }

  // Daily Neuron budget gate — fail closed when the cap is hit so we never
  // exceed the 10k/day Workers AI free tier.
  const ttsDebit = await tryDebitNeurons(c.env, estimateNeuronCost('@cf/myshell-ai/melotts'));
  if (!ttsDebit.allowed) {
    return buildBudgetExhaustedResponse(ttsDebit);
  }

  try {
    const ttsResult = (await c.env.AI.run('@cf/myshell-ai/melotts', {
      prompt: llmText,
      lang: 'en',
    })) as { audio: string };

    const binaryString = atob(ttsResult.audio);
    const audioBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i);
    }

    return new Response(audioBytes.buffer as ArrayBuffer, {
      headers: {
        'content-type': 'audio/mpeg',
        'x-transcribed-text': encodeURIComponent(transcribedText),
        'x-llm-response': encodeURIComponent(llmText.slice(0, 500)),
      },
    });
  } catch (ttsErr) {
    return c.json(
      { error: { message: `TTS failed: ${getErrorMessage(ttsErr)}`, type: 'provider_error', code: 'tts_failed' } },
      502,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// Multi-modal endpoints: image, video, TTS
// ═══════════════════════════════════════════════════════════════════

// ── Schemas ────────────────────────────────────────────────────────
const imageGenRequestSchema = z
  .object({
    model: z.string().default('auto'),
    prompt: z.string().min(1).max(8000),
    n: z.number().int().min(1).max(4).optional(),
    size: z.enum(['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024']).optional(),
    response_format: z.enum(['url', 'b64_json']).optional(),
    quality: z.string().optional(),
    style: z.string().optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('ImageGenerationRequest');

const imageGenResponseSchema = z
  .object({
    created: z.number(),
    data: z.array(
      z.object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
        revised_prompt: z.string().optional(),
      }),
    ),
    x_gateway: gatewayMetaSchema.optional(),
  })
  .openapi('ImageGenerationResponse');

const videoGenRequestSchema = z
  .object({
    model: z.string().default('auto'),
    prompt: z.string().min(1).max(8000),
    duration_seconds: z.number().int().min(1).max(60).optional(),
    aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
    image_url: z.string().url().optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('VideoGenerationRequest');

const videoGenResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(['processing', 'completed', 'failed']),
    video_url: z.string().optional(),
    poll_url: z.string().optional(),
    error: z.string().optional(),
    x_gateway: gatewayMetaSchema.optional(),
  })
  .openapi('VideoGenerationResponse');

const ttsRequestSchema = z
  .object({
    model: z.string().default('auto'),
    input: z.string().min(1).max(10_000),
    voice: z.string().optional(),
    response_format: z.enum(['mp3', 'wav', 'opus', 'flac']).optional(),
    speed: z.number().min(0.25).max(4.0).optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('TtsRequest');

// ── /v1/images/generations ─────────────────────────────────────────
const imagesGenRoute = createRoute({
  method: 'post',
  path: '/v1/images/generations',
  request: {
    body: { content: { 'application/json': { schema: imageGenRequestSchema } } },
  },
  responses: {
    200: { description: 'Image generated', content: { 'application/json': { schema: imageGenResponseSchema } } },
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    502: { description: 'All providers failed', content: { 'application/json': { schema: errorSchema } } },
    503: { description: 'No image provider configured', content: { 'application/json': { schema: errorSchema } } },
  },
});

app.openapi(imagesGenRoute, async (c) => {
  const body = c.req.valid('json');
  const requestId = createRequestId();
  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const projectId = resolveProjectId(headerProjectId, body.project_id);
  if (!projectId) {
    return c.json(
      { error: { message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]', type: 'invalid_request_error', code: 'invalid_project_id' } },
      400,
    );
  }

  const forcedProvider = c.req.header('x-gateway-force-provider') ?? undefined;
  const requestedModel = body.model.trim();
  const requestedLower = requestedModel.toLowerCase();

  const registry = getImageRegistry(c.env).filter((cand) => {
    if (forcedProvider && cand.provider !== forcedProvider) return false;
    if (requestedModel && requestedLower !== 'auto' && cand.model !== requestedModel && cand.id !== requestedModel) return false;
    if (!hasImageProviderKey(c.env, cand.provider)) return false;
    return true;
  });

  if (registry.length === 0) {
    return c.json(
      {
        error: {
          message: 'Image generation unavailable: no Together/Gemini/NVIDIA key and Workers AI binding missing',
          type: 'configuration_error',
          code: 'no_image_provider',
        },
      },
      503,
    );
  }

  const sorted = [...registry].sort((a, b) => b.priority - a.priority);
  let lastError = 'Unknown error';
  let attempts = 0;
  let chosenProvider: string | undefined;
  let chosenModel: string | undefined;

  for (const cand of sorted.slice(0, 3)) {
    attempts += 1;
    chosenProvider = cand.provider;
    chosenModel = cand.model;

    try {
      const caller = imageProviderCallers[cand.provider];
      const result = await caller({
        env: c.env,
        model: cand.model,
        prompt: body.prompt,
        n: body.n,
        size: body.size,
        response_format: body.response_format,
      });

      c.executionCtx.waitUntil(
        recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'ok', provider: cand.provider, model: cand.model }),
      );

      return c.json(
        {
          created: result.created,
          data: result.data,
          x_gateway: {
            provider: cand.provider,
            model: cand.model,
            attempts,
            reasoning_effort: 'auto' as const,
            request_id: requestId,
            project_id: projectId,
          },
        } as never,
        200,
      );
    } catch (err) {
      lastError = getErrorMessage(err);
      continue;
    }
  }

  c.executionCtx.waitUntil(
    recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'error', provider: chosenProvider as Provider | undefined, model: chosenModel }),
  );

  return c.json(
    { error: { message: `All image providers failed: ${lastError}`, type: 'provider_error' } },
    502,
  );
});

// ── /v1/videos/generations (async: submit) ──────────────────────────
const videosGenRoute = createRoute({
  method: 'post',
  path: '/v1/videos/generations',
  request: {
    body: { content: { 'application/json': { schema: videoGenRequestSchema } } },
  },
  responses: {
    202: { description: 'Video job submitted', content: { 'application/json': { schema: videoGenResponseSchema } } },
    200: { description: 'Video completed synchronously', content: { 'application/json': { schema: videoGenResponseSchema } } },
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    502: { description: 'Provider failure', content: { 'application/json': { schema: errorSchema } } },
    503: { description: 'No video provider', content: { 'application/json': { schema: errorSchema } } },
  },
});

app.openapi(videosGenRoute, async (c) => {
  const body = c.req.valid('json');
  const requestId = createRequestId();
  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const projectId = resolveProjectId(headerProjectId, body.project_id);
  if (!projectId) {
    return c.json(
      { error: { message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]', type: 'invalid_request_error', code: 'invalid_project_id' } },
      400,
    );
  }

  const requestedModel = body.model.trim();
  const requestedLower = requestedModel.toLowerCase();

  const registry = getVideoRegistry(c.env).filter((cand) => {
    if (requestedModel && requestedLower !== 'auto' && cand.model !== requestedModel && cand.id !== requestedModel) return false;
    if (!hasVideoProviderKey(c.env, cand.provider)) return false;
    return true;
  });

  if (registry.length === 0) {
    return c.json(
      {
        error: {
          message: 'Video generation unavailable: TOGETHER_API_KEY not configured or model not found',
          type: 'configuration_error',
          code: 'no_video_provider',
        },
      },
      503,
    );
  }

  const chosen = registry.sort((a, b) => b.priority - a.priority)[0];

  try {
    const submitter = videoProviderCallers[chosen.provider].submit;
    const job = await submitter({
      env: c.env,
      model: chosen.model,
      prompt: body.prompt,
      duration_seconds: body.duration_seconds,
      aspect_ratio: body.aspect_ratio,
      image_url: body.image_url,
    });

    const statusCode = job.status === 'completed' ? 200 : 202;

    c.executionCtx.waitUntil(
      recordAnalytics({
        db: c.env.GATEWAY_DB,
        projectId,
        outcome: job.status === 'failed' ? 'error' : 'ok',
        provider: chosen.provider,
        model: chosen.model,
      }),
    );

    // Persist job mapping to KV so polling can recover project_id context (best-effort).
    try {
      await c.env.HEALTH_KV.put(
        `video_job:${job.id}`,
        JSON.stringify({ provider: chosen.provider, model: chosen.model, project_id: projectId }),
        { expirationTtl: 60 * 60 * 24 },
      );
    } catch {
      // Ignore KV failures
    }

    return c.json(
      {
        id: job.id,
        status: job.status,
        video_url: job.video_url,
        poll_url: `/v1/videos/generations/${job.id}`,
        error: job.error,
        x_gateway: {
          provider: chosen.provider,
          model: chosen.model,
          attempts: 1,
          reasoning_effort: 'auto' as const,
          request_id: requestId,
          project_id: projectId,
        },
      } as never,
      statusCode as 200 | 202,
    );
  } catch (err) {
    c.executionCtx.waitUntil(
      recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'error', provider: chosen.provider, model: chosen.model }),
    );
    return c.json(
      { error: { message: `Video submit failed: ${getErrorMessage(err)}`, type: 'provider_error' } },
      502,
    );
  }
});

// ── /v1/videos/generations/{id} (poll) ──────────────────────────────
const videosPollRoute = createRoute({
  method: 'get',
  path: '/v1/videos/generations/{id}',
  request: { params: z.object({ id: z.string().min(1).max(256) }) },
  responses: {
    200: { description: 'Video job status', content: { 'application/json': { schema: videoGenResponseSchema } } },
    404: { description: 'Job not found', content: { 'application/json': { schema: errorSchema } } },
    501: { description: 'Not implemented — upstream poll endpoint undocumented', content: { 'application/json': { schema: errorSchema } } },
    502: { description: 'Provider failure', content: { 'application/json': { schema: errorSchema } } },
    503: { description: 'Provider not configured', content: { 'application/json': { schema: errorSchema } } },
  },
});

app.openapi(videosPollRoute, async (c) => {
  const { id } = c.req.valid('param');

  let provider: VideoProvider = 'together';
  let model = '';
  let projectId: string | undefined;

  try {
    const meta = await c.env.HEALTH_KV.get(`video_job:${id}`, 'json') as
      | { provider?: VideoProvider; model?: string; project_id?: string }
      | null;
    if (meta?.provider) provider = meta.provider;
    if (meta?.model) model = meta.model;
    if (meta?.project_id) projectId = meta.project_id;
  } catch {
    // Ignore KV lookup failure — fall back to default (together).
  }

  if (!hasVideoProviderKey(c.env, provider)) {
    return c.json(
      { error: { message: 'Video provider not configured', type: 'configuration_error', code: 'no_video_provider' } },
      503,
    );
  }

  try {
    const poller = videoProviderCallers.together.poll;
    const job = await poller(c.env, id);
    return c.json(
      {
        id: job.id,
        status: job.status,
        video_url: job.video_url,
        error: job.error,
        x_gateway: {
          provider,
          model,
          attempts: 1,
          reasoning_effort: 'auto' as const,
          request_id: createRequestId(),
          project_id: projectId,
        },
      } as never,
      200,
    );
  } catch (err) {
    // Together's video poll endpoint is undocumented upstream — returns 404 on all known paths.
    // Mark explicitly as "pending upstream support" so callers know it's not a transient error.
    return c.json(
      {
        error: {
          message: `Video poll not yet supported by Together upstream (undocumented GET endpoint). Submit works; retrieval pending. Underlying error: ${getErrorMessage(err)}`,
          type: 'not_implemented',
          code: 'video_poll_pending_upstream',
        },
      },
      501,
    );
  }
});

// ── /v1/audio/speech (TTS standalone) ───────────────────────────────
const audioSpeechRoute = createRoute({
  method: 'post',
  path: '/v1/audio/speech',
  request: {
    body: { content: { 'application/json': { schema: ttsRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Synthesized audio bytes',
      content: {
        'audio/mpeg': { schema: z.unknown() },
        'audio/wav': { schema: z.unknown() },
        'audio/opus': { schema: z.unknown() },
      },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    502: { description: 'Provider failure', content: { 'application/json': { schema: errorSchema } } },
    503: { description: 'No TTS provider', content: { 'application/json': { schema: errorSchema } } },
  },
});

app.openapi(audioSpeechRoute, async (c) => {
  const body = c.req.valid('json');
  const headerProjectId = c.req.header('x-gateway-project-id') ?? undefined;
  const projectId = resolveProjectId(headerProjectId, body.project_id);
  if (!projectId) {
    return c.json(
      { error: { message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]', type: 'invalid_request_error', code: 'invalid_project_id' } },
      400,
    );
  }

  const forcedProvider = c.req.header('x-gateway-force-provider') ?? undefined;
  const requestedModel = body.model.trim();
  const requestedLower = requestedModel.toLowerCase();

  const registry = getTtsRegistry(c.env).filter((cand) => {
    if (forcedProvider && cand.provider !== forcedProvider) return false;
    if (requestedModel && requestedLower !== 'auto' && cand.model !== requestedModel && cand.id !== requestedModel) return false;
    if (!hasTtsProviderKey(c.env, cand.provider)) return false;
    return true;
  });

  if (registry.length === 0) {
    return c.json(
      {
        error: {
          message: 'TTS unavailable: no GROQ_API_KEY and Workers AI binding missing',
          type: 'configuration_error',
          code: 'no_tts_provider',
        },
      },
      503,
    );
  }

  const sorted = [...registry].sort((a, b) => b.priority - a.priority);
  let lastError = 'Unknown error';
  let chosenProvider: string | undefined;
  let chosenModel: string | undefined;

  for (const cand of sorted) {
    chosenProvider = cand.provider;
    chosenModel = cand.model;

    try {
      const caller = ttsProviderCallers[cand.provider];
      const result = await caller({
        env: c.env,
        model: cand.model,
        input: body.input,
        voice: body.voice,
        response_format: body.response_format,
        speed: body.speed,
      });

      c.executionCtx.waitUntil(
        recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'ok', provider: cand.provider, model: cand.model }),
      );

      return new Response(result.audio, {
        headers: {
          'content-type': result.contentType,
          'x-gateway-provider': cand.provider,
          'x-gateway-model': cand.model,
          'x-gateway-project-id': projectId,
        },
      });
    } catch (err) {
      lastError = getErrorMessage(err);
      continue;
    }
  }

  c.executionCtx.waitUntil(
    recordAnalytics({ db: c.env.GATEWAY_DB, projectId, outcome: 'error', provider: chosenProvider as Provider | undefined, model: chosenModel }),
  );
  return c.json(
    { error: { message: `All TTS providers failed: ${lastError}`, type: 'provider_error' } },
    502,
  );
});

const modelsRoute = createRoute({
  method: 'get',
  path: '/v1/models',
  responses: {
    200: {
      description: 'Models and routing status',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(modelItemSchema) }),
        },
      },
    },
  },
});

app.openapi(modelsRoute, async (c) => {
  const registry = getModelRegistry(c.env);
  const limits = getProviderLimits(c.env);
  const keys = registry.map((candidate) => getModelKey(candidate.provider, candidate.model));

  const lookupLimits: Record<string, ProviderLimitConfig> = {};
  for (const candidate of registry) {
    const key = getModelKey(candidate.provider, candidate.model);
    lookupLimits[key] = limits[key] ?? { requestsPerDay: 200 };
  }

  const stateMap = await healthLookup(c.env, keys, lookupLimits, Date.now());
  const evaluationMap = parseEvaluationWeights(c.env.MODEL_EVALUATIONS_JSON);

  const parallel = pLimit(8);
  const data = await Promise.all(
    registry.map((candidate) =>
      parallel(async () => {
        const key = getModelKey(candidate.provider, candidate.model);
        const snapshot = stateMap.get(key);
        const evaluation = evaluationMap.get(key) ?? evaluationMap.get(candidate.id);
        return {
          id: candidate.id,
          provider: candidate.provider,
          model: candidate.model,
          reasoning: candidate.reasoning,
          supports_streaming: candidate.supportsStreaming,
          cooldown_until: snapshot?.cooldownUntil ?? 0,
          success_rate: snapshot?.successRate ?? 0.5,
          headroom: snapshot?.headroom ?? 1,
          evaluation_weight: evaluationWeight(evaluation),
          evaluation_sample_count: evaluation?.sampleCount ?? 0,
          evaluated_at: evaluation?.evaluatedAt ?? null,
          enabled: candidate.enabled,
        };
      }),
    ),
  );

  return c.json({ data });
});


const setDashboardHeaders = (c: { header: (k: string, v: string) => void }) => {
  c.header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('cdn-cache-control', 'no-store');
  c.header('cloudflare-cdn-cache-control', 'no-store');
};
app.get('/dashboard', (c) => { setDashboardHeaders(c); return c.html(DASHBOARD_HTML); });
app.get('/dashboard/', (c) => c.redirect('/dashboard'));
app.get('/live', (c) => { setDashboardHeaders(c); return c.html(DASHBOARD_HTML); });
app.get('/v1/dashboard', (c) => { setDashboardHeaders(c); return c.html(DASHBOARD_HTML); });

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  responses: {
    200: {
      description: 'Gateway health summary',
      content: {
        'application/json': {
          schema: healthSchema,
        },
      },
    },
  },
});

app.openapi(healthRoute, async (c) => {
  const snapshots = await healthSnapshot(c.env);
  return c.json({
    ok: true,
    models: snapshots.map((snapshot) => ({
      key: snapshot.key,
      attempts: snapshot.attempts,
      success_rate: snapshot.successRate,
      avg_latency_ms: snapshot.avgLatencyMs,
      cooldown_until: snapshot.cooldownUntil,
      headroom: snapshot.headroom,
      daily_used: snapshot.dailyUsed,
      daily_limit: snapshot.dailyLimit,
    })),
  });
});

const analyticsRoute = createRoute({
  method: 'get',
  path: '/v1/analytics',
  request: {
    query: z.object({
      project_id: z.string().optional(),
      days: z.coerce.number().int().min(1).max(365).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Usage analytics',
      content: { 'application/json': { schema: analyticsResponseSchema } },
    },
    400: { description: 'Bad Request' },
    401: { description: 'Unauthorized' },
  },
});

app.openapi(analyticsRoute, async (c) => {
  // Analytics is publicly readable. Only data-generating endpoints require GATEWAY_API_KEY.
  const query = c.req.valid('query');
  const projectId = query.project_id;
  const days = query.days;

  const filters: string[] = [];
  const params: unknown[] = [];
  if (projectId) {
    filters.push('project_id = ?');
    params.push(projectId);
  }
  if (days) {
    filters.push(`date >= date('now', ?)`);
    params.push(`-${days} days`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const stats = await c.env.GATEWAY_DB.prepare(
    `SELECT SUM(total_requests) as total, SUM(successful_requests) as successful, SUM(failed_requests) as failed FROM project_analytics ${where}`
  ).bind(...params).first<{ total: number | null; successful: number | null; failed: number | null }>();

  const providerStats = await c.env.GATEWAY_DB.prepare(
    `SELECT provider, SUM(total_requests) as requests, SUM(successful_requests) as successful, SUM(failed_requests) as failed FROM project_analytics ${where} GROUP BY provider`
  ).bind(...params).all<{ provider: string; requests: number; successful: number; failed: number }>();

  const modelStats = await c.env.GATEWAY_DB.prepare(
    `SELECT model, SUM(total_requests) as requests, SUM(successful_requests) as successful, SUM(failed_requests) as failed FROM project_analytics ${where} GROUP BY model`
  ).bind(...params).all<{ model: string; requests: number; successful: number; failed: number }>();

  const projectStats = await c.env.GATEWAY_DB.prepare(
    `SELECT project_id, SUM(total_requests) as requests, SUM(successful_requests) as successful, SUM(failed_requests) as failed FROM project_analytics ${where} GROUP BY project_id`
  ).bind(...params).all<{ project_id: string; requests: number; successful: number; failed: number }>();

  const dailyStats = await c.env.GATEWAY_DB.prepare(
    `SELECT date, SUM(total_requests) as requests, SUM(successful_requests) as successful, SUM(failed_requests) as failed FROM project_analytics ${where} GROUP BY date ORDER BY date ASC`
  ).bind(...params).all<{ date: string; requests: number; successful: number; failed: number }>();

  const providers: Record<string, unknown> = {};
  providerStats.results.forEach((p) => {
    providers[p.provider] = { requests: p.requests, successful: p.successful, failed: p.failed };
  });
  const models: Record<string, unknown> = {};
  modelStats.results.forEach((m) => {
    models[m.model] = { requests: m.requests, successful: m.successful, failed: m.failed };
  });
  const projects: Record<string, unknown> = {};
  projectStats.results.forEach((p) => {
    projects[p.project_id] = { requests: p.requests, successful: p.successful, failed: p.failed };
  });

  const total = stats?.total ?? 0;
  return c.json({
    total_requests: total,
    successful_requests: stats?.successful ?? 0,
    failed_requests: stats?.failed ?? 0,
    success_rate: total > 0 ? (stats?.successful ?? 0) / total : 0,
    providers,
    models,
    projects,
    daily: dailyStats.results,
  });
});

app.get('/v1/stats/providers', async (c) => {
  const stats = await providerStats(c.env);
  return c.json({ stats });
});

// Workers AI daily Neuron budget — sole chokepoint for Fleet-wide AI traffic.
// Hard cap is 9500 Neurons/day (500 buffer below the 10k/day free quota).
app.get('/v1/budget', async (c) => {
  const usage = await getNeuronUsage(c.env);
  if (!usage) {
    return c.json({
      error: { message: 'NEURON_BUDGET binding unavailable', type: 'configuration_error' },
    }, 503);
  }
  return c.json(usage);
});

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'sass-maker AI Gateway API',
    version: '1.0.0',
    description:
      'OpenAI-compatible AI gateway with health-aware free-tier routing across Workers AI, Groq, Gemini, Voyage AI embeddings, voice (Whisper STT + Workers AI TTS), and optional OpenRouter/Cerebras.',
  },
});



// Fallback to static assets (docs site) for any path worker doesn't handle
app.notFound((c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: { message: 'Not found', type: 'not_found' } }, 404);
});

export default app;
export { HealthStateDO, IpRateLimitDO, NeuronBudgetDO };
