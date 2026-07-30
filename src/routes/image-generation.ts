import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { getImageRegistry, hasImageProviderKey } from '../config';
import { CostBudget } from '../lib/cost-budget';
import { imageProviderCallers } from '../providers';
import { classifyError, isRetriableFailure } from '../router/classify-error';
import type { Env, Provider } from '../types';
import { createRequestId, getErrorMessage } from '../utils/request';
import { sortFallbackLast } from './provider-order';

type GatewayApp = OpenAPIHono<{ Bindings: Env }>;

type RecordAnalytics = (params: {
  db: D1Database;
  projectId?: string;
  outcome: 'ok' | 'error';
  provider?: Provider;
  model?: string;
}) => Promise<void>;

const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._:-]+$/);

const gatewayMetaSchema = z.object({
  provider: z.string(),
  model: z.string(),
  attempts: z.number().int().min(1),
  reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']),
  request_id: z.string(),
  project_id: z.string().optional(),
});

const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
});

const imageGenRequestSchema = z
  .object({
    model: z.string().default('auto'),
    prompt: z.string().min(1).max(2000),
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
      })
    ),
    x_gateway: gatewayMetaSchema.optional(),
  })
  .openapi('ImageGenerationResponse');

const imagesGenRoute = createRoute({
  method: 'post',
  path: '/v1/images/generations',
  request: {
    body: { content: { 'application/json': { schema: imageGenRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Image generated',
      content: { 'application/json': { schema: imageGenResponseSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    429: {
      description: 'Rate limited or retriable provider failure',
      content: { 'application/json': { schema: errorSchema } },
    },
    502: {
      description: 'All providers failed',
      content: { 'application/json': { schema: errorSchema } },
    },
    503: {
      description: 'No image provider configured',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

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

export function registerImageGenerationRoute(
  app: GatewayApp,
  recordAnalytics: RecordAnalytics
): void {
  app.openapi(imagesGenRoute, async (context) => {
    const body = context.req.valid('json');
    const requestId = createRequestId();
    const headerProjectId = context.req.header('x-gateway-project-id') ?? undefined;
    const projectId = resolveProjectId(headerProjectId, body.project_id);
    if (!projectId) {
      return context.json(
        {
          error: {
            message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
            type: 'invalid_request_error',
            code: 'invalid_project_id',
          },
        },
        400
      );
    }

    const forcedProvider = context.req.header('x-gateway-force-provider') ?? undefined;
    const requestedModel = body.model.trim();
    const requestedLower = requestedModel.toLowerCase();
    const registry = getImageRegistry(context.env).filter((candidate) => {
      if (forcedProvider && candidate.provider !== forcedProvider) return false;
      if (
        requestedModel &&
        requestedLower !== 'auto' &&
        candidate.model !== requestedModel &&
        candidate.id !== requestedModel
      ) {
        return false;
      }
      return hasImageProviderKey(context.env, candidate.provider);
    });

    if (registry.length === 0) {
      return context.json(
        {
          error: {
            message:
              'Image generation unavailable: no Together/Gemini/NVIDIA key and Workers AI binding missing',
            type: 'configuration_error',
            code: 'no_image_provider',
          },
        },
        503
      );
    }

    const sorted = sortFallbackLast(registry, !forcedProvider && requestedLower === 'auto');
    let lastError = 'Unknown error';
    let attempts = 0;
    let chosenProvider: string | undefined;
    let chosenModel: string | undefined;
    let lastErrorClass = 'provider_fatal';
    const costBudget = new CostBudget({ maxAttempts: 3, maxTotalTimeoutMs: 180_000 });

    for (const candidate of sorted.slice(0, 3)) {
      if (!costBudget.canAttempt()) break;

      attempts += 1;
      chosenProvider = candidate.provider;
      chosenModel = candidate.model;
      costBudget.recordAttempt(60_000);

      try {
        const caller = imageProviderCallers[candidate.provider];
        const result = await caller({
          env: context.env,
          model: candidate.model,
          prompt: body.prompt,
          n: body.n,
          size: body.size,
          response_format: body.response_format,
        });

        context.executionCtx.waitUntil(
          recordAnalytics({
            db: context.env.GATEWAY_DB,
            projectId,
            outcome: 'ok',
            provider: candidate.provider,
            model: candidate.model,
          })
        );

        const degraded = attempts > 1;
        return context.json(
          {
            created: result.created,
            data: result.data,
            degraded,
            x_gateway: {
              provider: candidate.provider,
              model: candidate.model,
              attempts,
              reasoning_effort: 'auto' as const,
              request_id: requestId,
              project_id: projectId,
            },
          } as never,
          200,
          degraded ? { 'x-degraded-mode': 'true' } : undefined
        );
      } catch (error) {
        lastError = getErrorMessage(error);
        const failureClass = classifyError(error);
        lastErrorClass = failureClass;
        if (!isRetriableFailure(failureClass)) {
          break;
        }
      }
    }

    context.executionCtx.waitUntil(
      recordAnalytics({
        db: context.env.GATEWAY_DB,
        projectId,
        outcome: 'error',
        provider: chosenProvider as Provider | undefined,
        model: chosenModel,
      })
    );

    const errorStatus =
      lastErrorClass === 'input_nonretriable'
        ? 400
        : lastErrorClass === 'usage_retriable'
          ? 429
          : 502;

    return context.json(
      {
        error: {
          message: `All image providers failed: ${lastError}`,
          type: lastErrorClass,
          cost_budget: costBudget.state(),
        },
      } as never,
      errorStatus
    );
  });
}
