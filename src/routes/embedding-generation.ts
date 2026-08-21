import { createRoute, z } from '@hono/zod-openapi';
import pRetry, { AbortError } from 'p-retry';

import { isWorkersAiEnabled } from '../config';
import { providerEmbeddingCallers } from '../providers';
import { classifyError, isRetriableFailure } from '../router/classify-error';
import type { EmbeddingProvider, Env, GatewayMeta, Provider } from '../types';
import { createRequestId, getErrorMessage } from '../utils/request';
import { type GatewayApp, type RecordAnalytics, projectIdSchema } from './shared-schemas';

export interface EmbeddingCandidate {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  supportsDimensions?: boolean;
  aliases?: string[];
  priority: number;
}

export const EMBEDDING_CANDIDATES: EmbeddingCandidate[] = [
  {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimensions: 1536,
    supportsDimensions: true,
    aliases: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-004'],
    priority: 0.95,
  },
  {
    provider: 'voyage_ai',
    model: 'voyage-3.5-lite',
    dimensions: 1024,
    priority: 0.91,
  },
  {
    provider: 'voyage_ai',
    model: 'voyage-3-lite',
    dimensions: 1024,
    priority: 0.88,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-large-en-v1.5',
    dimensions: 1024,
    priority: 0.87,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-base-en-v1.5',
    dimensions: 768,
    priority: 0.85,
  },
  {
    provider: 'workers_ai',
    model: '@cf/baai/bge-small-en-v1.5',
    dimensions: 384,
    priority: 0.8,
  },
];

const EMBEDDING_MODEL_ALIASES: Record<string, string> = {
  'text-embedding-3-small': 'gemini-embedding-001',
  'text-embedding-3-large': 'gemini-embedding-001',
  'text-embedding-004': 'gemini-embedding-001',
};

const gatewayMetaSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    attempts: z.number().int().min(1),
    reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']),
    request_id: z.string(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('EmbeddingGatewayMeta');

const embeddingsRequestSchema = z
  .object({
    model: z.string().min(1),
    input: z.union([z.string(), z.array(z.string().min(1)).min(1)]),
    encoding_format: z.enum(['float']).optional(),
    dimensions: z.number().int().min(1).max(4096).optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('EmbeddingsRequest');

const embeddingsResponseSchema = z
  .object({
    object: z.literal('list'),
    data: z.array(
      z.object({
        object: z.literal('embedding'),
        index: z.number(),
        embedding: z.array(z.number()),
      })
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

const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
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

function workersAiEmbeddingAvailable(env: Env): boolean {
  if (!isWorkersAiEnabled(env)) {
    return false;
  }

  if (env.AI && typeof env.AI.run === 'function') {
    return true;
  }

  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY);
}

export function embeddingCandidateEnabled(env: Env, candidate: EmbeddingCandidate): boolean {
  if (candidate.provider === 'gemini') {
    return Boolean(env.GEMINI_API_KEY);
  }

  if (candidate.provider === 'workers_ai') {
    return workersAiEmbeddingAvailable(env);
  }

  if (candidate.provider === 'voyage_ai') {
    return Boolean(env.VOYAGE_API_KEY);
  }

  return false;
}

function getForcedEmbeddingProvider(context: {
  req: { header: (key: string) => string | undefined };
}): EmbeddingProvider | undefined {
  const value = context.req.header('x-gateway-force-provider');
  if (!value) {
    return undefined;
  }

  if (['workers_ai', 'gemini', 'voyage_ai'].includes(value)) {
    return value as EmbeddingProvider;
  }

  return undefined;
}

function normalizeEmbeddingInput(input: string | string[]): string[] {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }

  return input.map((value) => value.trim()).filter((value) => value.length > 0);
}

function resolveEmbeddingCandidates(
  env: Env,
  params: {
    requestedModel: string;
    forcedProvider?: EmbeddingProvider;
    forcedModel?: string;
  }
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
    return embeddingCandidateEnabled(env, candidate);
  });

  return filtered.sort((a, b) => {
    const aPreferred = preferredModel !== 'auto' && a.model === preferredModel;
    const bPreferred = preferredModel !== 'auto' && b.model === preferredModel;

    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;
    return b.priority - a.priority;
  });
}

function resolveProjectId(
  headerValue: string | undefined,
  bodyValue: string | undefined
): string | undefined {
  const candidate = (headerValue ?? bodyValue)?.trim();
  if (!candidate) {
    return undefined;
  }

  return projectIdSchema.safeParse(candidate).success ? candidate : undefined;
}

function buildGatewayMeta(params: {
  provider: Provider;
  model: string;
  attempts: number;
  requestId: string;
  projectId?: string;
}): GatewayMeta {
  return {
    provider: params.provider,
    model: params.model,
    attempts: params.attempts,
    reasoning_effort: 'auto',
    request_id: params.requestId,
    project_id: params.projectId,
  };
}

type EmbeddingValidationResult =
  | {
      ok: true;
      projectId: string;
      requestedModel: string;
      normalizedInput: string[];
    }
  | {
      ok: false;
      status: 400;
      body: { error: { message: string; type: string; code: string } };
    };

function validateEmbeddingRequest(params: {
  model: string;
  input: string | string[];
  project_id?: string;
  headerProjectId: string | undefined;
}): EmbeddingValidationResult {
  const projectId = resolveProjectId(params.headerProjectId, params.project_id);
  if (!projectId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
          type: 'invalid_request_error',
          code: 'invalid_project_id',
        },
      },
    };
  }

  const requestedModel = params.model.trim();
  if (!requestedModel || requestedModel.toLowerCase() === 'auto') {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          message: '`model` is required for embeddings and cannot be "auto"',
          type: 'invalid_request_error',
          code: 'invalid_embedding_model',
        },
      },
    };
  }

  const normalizedInput = normalizeEmbeddingInput(params.input);
  if (normalizedInput.length === 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          message: '`input` is required',
          type: 'invalid_request_error',
          code: 'missing_input',
        },
      },
    };
  }

  return { ok: true, projectId, requestedModel, normalizedInput };
}

function noEmbeddingProviderError() {
  return {
    error: {
      message: 'No embedding provider is configured',
      type: 'configuration_error',
      code: 'no_embedding_provider',
    },
  };
}

interface EmbeddingAttemptResult {
  finalResponse: Record<string, unknown> | null;
  chosenMeta: GatewayMeta | undefined;
  lastErrorClass: string;
  lastErrorMessage: string;
  lastAttemptedProvider: EmbeddingProvider | undefined;
  lastAttemptedModel: string | undefined;
}

async function runEmbeddingAttempts(params: {
  env: Env;
  candidates: EmbeddingCandidate[];
  normalizedInput: string[];
  encodingFormat?: 'float';
  dimensions?: number;
  requestId: string;
  projectId: string;
}): Promise<EmbeddingAttemptResult> {
  let attemptCounter = 0;
  let chosenMeta: GatewayMeta | undefined;
  let finalResponse: Record<string, unknown> | null = null;
  let lastErrorClass = 'provider_fatal';
  let lastErrorMessage = 'Unknown error';
  let lastAttemptedProvider: EmbeddingProvider | undefined;
  let lastAttemptedModel: string | undefined;
  const maxEmbeddingAttempts = Math.max(1, params.candidates.length);

  await pRetry(
    async () => {
      const candidate = params.candidates[attemptCounter];
      if (!candidate || attemptCounter >= maxEmbeddingAttempts) {
        throw new AbortError('No more embedding candidates');
      }

      attemptCounter += 1;
      lastAttemptedProvider = candidate.provider;
      lastAttemptedModel = candidate.model;

      try {
        const caller = providerEmbeddingCallers[candidate.provider];
        const result = await caller({
          env: params.env,
          provider: candidate.provider,
          model: candidate.model,
          input: params.normalizedInput,
          encoding_format: params.encodingFormat,
          dimensions: params.dimensions,
        });

        chosenMeta = buildGatewayMeta({
          provider: candidate.provider,
          model: candidate.model,
          attempts: attemptCounter,
          requestId: params.requestId,
          projectId: params.projectId,
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
      minTimeout: 500,
      maxTimeout: 5000,
      factor: 2,
      randomize: true,
    }
  ).catch(() => undefined);

  return {
    finalResponse,
    chosenMeta,
    lastErrorClass,
    lastErrorMessage,
    lastAttemptedProvider,
    lastAttemptedModel,
  };
}

function embeddingErrorStatus(errorClass: string): 400 | 429 | 502 {
  if (errorClass === 'input_nonretriable') return 400;
  if (errorClass === 'usage_retriable') return 429;
  return 502;
}

function buildEmbeddingErrorBody(lastErrorMessage: string, lastErrorClass: string) {
  return {
    error: {
      message: `All embedding providers failed: ${lastErrorMessage}`,
      type: lastErrorClass,
    },
  };
}

export function registerEmbeddingGenerationRoute(
  app: GatewayApp,
  recordAnalytics: RecordAnalytics
): void {
  app.openapi(embeddingsRoute, async (context) => {
    const body = context.req.valid('json');
    const requestId = createRequestId();
    const forcedProvider = getForcedEmbeddingProvider(context);
    const forcedModel = context.req.header('x-gateway-force-model') ?? undefined;
    const headerProjectId = context.req.header('x-gateway-project-id') ?? undefined;

    const validation = validateEmbeddingRequest({
      model: body.model,
      input: body.input,
      project_id: body.project_id,
      headerProjectId,
    });
    if (!validation.ok) {
      return context.json(validation.body, validation.status);
    }

    const { projectId, requestedModel, normalizedInput } = validation;

    const candidates = resolveEmbeddingCandidates(context.env, {
      requestedModel,
      forcedProvider,
      forcedModel,
    });
    if (candidates.length === 0) {
      return context.json(noEmbeddingProviderError(), 503);
    }

    const result = await runEmbeddingAttempts({
      env: context.env,
      candidates,
      normalizedInput,
      encodingFormat: body.encoding_format,
      dimensions: body.dimensions,
      requestId,
      projectId,
    });

    if (result.finalResponse && result.chosenMeta) {
      context.executionCtx.waitUntil(
        recordAnalytics({
          db: context.env.GATEWAY_DB,
          projectId,
          outcome: 'ok',
          provider: result.chosenMeta.provider,
          model: result.chosenMeta.model,
        })
      );
      return context.json(result.finalResponse as never, 200);
    }

    context.executionCtx.waitUntil(
      recordAnalytics({
        db: context.env.GATEWAY_DB,
        projectId,
        outcome: 'error',
        provider: result.chosenMeta?.provider ?? result.lastAttemptedProvider,
        model: result.chosenMeta?.model ?? result.lastAttemptedModel,
      })
    );

    return context.json(
      buildEmbeddingErrorBody(result.lastErrorMessage, result.lastErrorClass),
      embeddingErrorStatus(result.lastErrorClass)
    );
  });
}
