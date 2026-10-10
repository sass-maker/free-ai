import { createRoute, z } from '@hono/zod-openapi';

import { getImageRegistry, hasImageProviderKey } from '../config';
import { CostBudget } from '../lib/cost-budget';
import { imageProviderCallers } from '../providers';
import {
  canFallbackFromProviderFailure,
  classifyError,
  getUpstreamStatus,
  isProviderAccountFailure,
  isProviderUnavailableForRequest,
  isRetriableFailure,
} from '../router/classify-error';
import { healthLookup, healthRecord } from '../state/client';
import type { Env, ImageModelCandidate, Provider } from '../types';
import { createRequestId, getErrorMessage } from '../utils/request';
import { sortFallbackLast } from './provider-order';
import {
  type GatewayApp,
  type RecordAnalytics,
  errorSchema,
  gatewayMetaSchema,
  projectIdSchema,
} from './shared-schemas';

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

function filterImageRegistry(
  env: Env,
  model: string,
  forcedProvider?: string
): ImageModelCandidate[] {
  const requestedLower = model.toLowerCase();
  return getImageRegistry(env).filter((candidate) => {
    if (forcedProvider && candidate.provider !== forcedProvider) return false;
    if (model && requestedLower !== 'auto' && candidate.model !== model && candidate.id !== model) {
      return false;
    }
    return hasImageProviderKey(env, candidate.provider);
  });
}

function invalidProjectIdError() {
  return {
    error: {
      message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
      type: 'invalid_request_error',
      code: 'invalid_project_id',
    },
  };
}

function noImageProviderError() {
  return {
    error: {
      message:
        'Image generation unavailable: no Together/Gemini/NVIDIA key and Workers AI binding missing',
      type: 'configuration_error',
      code: 'no_image_provider',
    },
  };
}

function buildImageSuccessBody(
  result: { created: number; data: unknown[] },
  candidate: { provider: string; model: string },
  attempts: number,
  requestId: string,
  projectId: string,
  degraded: boolean
) {
  return {
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
  } as never;
}

function imageErrorStatus(errorClass: string): 400 | 429 | 502 {
  if (errorClass === 'input_nonretriable') return 400;
  if (errorClass === 'usage_retriable') return 429;
  return 502;
}

function buildImageErrorBody(
  lastError: string,
  lastErrorClass: string,
  costBudget: CostBudget,
  attemptErrors: Array<{ provider: string; status: number | null }>
) {
  return {
    error: {
      message: `All image providers failed: ${lastError}`,
      type: lastErrorClass,
      cost_budget: costBudget.state(),
      attempts: attemptErrors,
    },
  } as never;
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
      return context.json(invalidProjectIdError(), 400);
    }

    const forcedProvider = context.req.header('x-gateway-force-provider') ?? undefined;
    const registry = filterImageRegistry(context.env, body.model, forcedProvider);
    if (registry.length === 0) {
      return context.json(noImageProviderError(), 503);
    }

    const auto = body.model.toLowerCase() === 'auto';
    const now = Date.now();
    // Separate image-provider health from chat model health and account cooldowns.
    const healthKey = (provider: string) => `${provider}:images`;
    const health = await healthLookup(
      context.env,
      [...new Set(registry.map((candidate) => healthKey(candidate.provider)))],
      {},
      now
    );
    let sorted = sortFallbackLast(registry, !forcedProvider && auto);
    if (auto) {
      const seen = new Set<string>();
      sorted = sorted.filter((candidate) => {
        if ((health.get(healthKey(candidate.provider))?.cooldownUntil ?? 0) > now) return false;
        if (seen.has(candidate.provider)) return false;
        seen.add(candidate.provider);
        return true;
      });
      sorted.sort((a, b) => {
        if (!forcedProvider) {
          const fallbackDiff =
            Number(a.provider === 'workers_ai') - Number(b.provider === 'workers_ai');
          if (fallbackDiff) return fallbackDiff;
        }
        const healthDiff =
          (health.get(healthKey(b.provider))?.successRate ?? 1) -
          (health.get(healthKey(a.provider))?.successRate ?? 1);
        return healthDiff || b.priority - a.priority;
      });
    }
    if (sorted.length === 0) return context.json(noImageProviderError(), 503);
    let lastError = 'Unknown error';
    let attempts = 0;
    let chosenProvider: string | undefined;
    let chosenModel: string | undefined;
    let lastErrorClass = 'provider_fatal';
    const costBudget = new CostBudget({ maxAttempts: 5, maxTotalTimeoutMs: 300_000 });
    const attemptErrors: Array<{ provider: string; status: number | null }> = [];
    const unavailable = new Set<string>();

    for (const candidate of sorted.slice(0, 5)) {
      if (unavailable.has(candidate.provider)) continue;
      if (!costBudget.canAttempt()) break;

      attempts += 1;
      chosenProvider = candidate.provider;
      chosenModel = candidate.model;
      costBudget.recordAttempt(60_000);
      const startedAt = Date.now();

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
          healthRecord(context.env, {
            key: healthKey(candidate.provider),
            success: true,
            latencyMs: Date.now() - startedAt,
            now: Date.now(),
          })
        );

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
          buildImageSuccessBody(result, candidate, attempts, requestId, projectId, degraded),
          200,
          degraded ? { 'x-degraded-mode': 'true' } : undefined
        );
      } catch (error) {
        lastError = getErrorMessage(error);
        const failureClass = classifyError(error);
        lastErrorClass = failureClass;
        attemptErrors.push({
          provider: candidate.provider,
          status: getUpstreamStatus(error) ?? null,
        });
        if (isProviderUnavailableForRequest(error)) unavailable.add(candidate.provider);
        if (failureClass !== 'input_nonretriable' && failureClass !== 'safety_refusal') {
          // Await writes so the next request observes account failures immediately.
          await healthRecord(context.env, {
            key: healthKey(candidate.provider),
            success: false,
            latencyMs: Date.now() - startedAt,
            failureClass,
            unavailableUntil: isProviderAccountFailure(error)
              ? Date.now() + 24 * 60 * 60 * 1000
              : undefined,
            now: Date.now(),
          });
        }
        if (
          !isRetriableFailure(failureClass) &&
          !canFallbackFromProviderFailure(error, failureClass) &&
          !(auto && failureClass === 'provider_fatal')
        ) {
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

    return context.json(
      buildImageErrorBody(lastError, lastErrorClass, costBudget, attemptErrors),
      imageErrorStatus(lastErrorClass)
    );
  });
}
