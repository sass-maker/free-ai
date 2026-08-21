import { createRoute, z } from '@hono/zod-openapi';

import { getVideoRegistry, hasVideoProviderKey } from '../config';
import { CostBudget } from '../lib/cost-budget';
import { videoProviderCallers } from '../providers';
import { classifyError } from '../router/classify-error';
import type { Env, VideoModelCandidate, VideoProvider } from '../types';
import { createRequestId, getErrorMessage } from '../utils/request';
import {
  type GatewayApp,
  type RecordAnalytics,
  errorSchema,
  gatewayMetaSchema,
  projectIdSchema,
} from './shared-schemas';

const videoGenRequestSchema = z
  .object({
    model: z.string().default('auto'),
    prompt: z.string().min(1).max(2000),
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

const videosGenRoute = createRoute({
  method: 'post',
  path: '/v1/videos/generations',
  request: {
    body: { content: { 'application/json': { schema: videoGenRequestSchema } } },
  },
  responses: {
    202: {
      description: 'Video job submitted',
      content: { 'application/json': { schema: videoGenResponseSchema } },
    },
    200: {
      description: 'Video completed synchronously',
      content: { 'application/json': { schema: videoGenResponseSchema } },
    },
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    429: {
      description: 'Rate limited or retriable provider failure',
      content: { 'application/json': { schema: errorSchema } },
    },
    502: {
      description: 'Provider failure',
      content: { 'application/json': { schema: errorSchema } },
    },
    503: {
      description: 'No video provider',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

const videosPollRoute = createRoute({
  method: 'get',
  path: '/v1/videos/generations/{id}',
  request: { params: z.object({ id: z.string().min(1).max(256) }) },
  responses: {
    200: {
      description: 'Video job status',
      content: { 'application/json': { schema: videoGenResponseSchema } },
    },
    404: { description: 'Job not found', content: { 'application/json': { schema: errorSchema } } },
    501: {
      description: 'Not implemented — upstream poll endpoint undocumented',
      content: { 'application/json': { schema: errorSchema } },
    },
    502: {
      description: 'Provider failure',
      content: { 'application/json': { schema: errorSchema } },
    },
    503: {
      description: 'Provider not configured',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

function filterVideoRegistry(env: Env, model: string): VideoModelCandidate[] {
  const requestedLower = model.toLowerCase();
  return getVideoRegistry(env).filter((candidate) => {
    if (model && requestedLower !== 'auto' && candidate.model !== model && candidate.id !== model) {
      return false;
    }
    return hasVideoProviderKey(env, candidate.provider);
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

function noVideoProviderError() {
  return {
    error: {
      message: 'Video generation unavailable: TOGETHER_API_KEY not configured or model not found',
      type: 'configuration_error',
      code: 'no_video_provider',
    },
  };
}

async function persistVideoJobMeta(
  env: Env,
  job: { id: string },
  chosen: { provider: VideoProvider; model: string },
  projectId: string
): Promise<void> {
  try {
    await env.HEALTH_KV.put(
      `video_job:${job.id}`,
      JSON.stringify({
        provider: chosen.provider,
        model: chosen.model,
        project_id: projectId,
      }),
      { expirationTtl: 60 * 60 * 24 }
    );
  } catch {
    // Job metadata is best-effort; polling falls back to the default provider.
  }
}

function buildVideoGenSuccessBody(
  job: {
    id: string;
    status: 'processing' | 'completed' | 'failed';
    video_url?: string;
    error?: string;
  },
  chosen: { provider: VideoProvider; model: string },
  requestId: string,
  projectId: string
) {
  return {
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
  };
}

function buildVideoGenErrorBody(error: unknown, failureClass: string, costBudget: CostBudget) {
  return {
    error: {
      message: `Video submit failed: ${getErrorMessage(error)}`,
      type: failureClass,
      cost_budget: costBudget.state(),
    },
  } as never;
}

async function loadVideoJobMeta(
  env: Env,
  id: string
): Promise<{ provider: VideoProvider; model: string; projectId?: string }> {
  let provider: VideoProvider = 'together';
  let model = '';
  let projectId: string | undefined;

  try {
    const meta = (await env.HEALTH_KV.get(`video_job:${id}`, 'json')) as {
      provider?: VideoProvider;
      model?: string;
      project_id?: string;
    } | null;
    if (meta?.provider) provider = meta.provider;
    if (meta?.model) model = meta.model;
    if (meta?.project_id) projectId = meta.project_id;
  } catch {
    // A missing mapping falls back to Together, matching the submit path.
  }

  return { provider, model, projectId };
}

function buildVideoPollSuccessBody(
  job: {
    id: string;
    status: 'processing' | 'completed' | 'failed';
    video_url?: string;
    error?: string;
  },
  provider: VideoProvider,
  model: string,
  requestId: string,
  projectId?: string
) {
  return {
    id: job.id,
    status: job.status,
    video_url: job.video_url,
    error: job.error,
    x_gateway: {
      provider,
      model,
      attempts: 1,
      reasoning_effort: 'auto' as const,
      request_id: requestId,
      project_id: projectId,
    },
  };
}

function buildVideoPollErrorBody(error: unknown) {
  return {
    error: {
      message: `Video poll not yet supported by Together upstream (undocumented GET endpoint). Submit works; retrieval pending. Underlying error: ${getErrorMessage(error)}`,
      type: 'not_implemented',
      code: 'video_poll_pending_upstream',
    },
  };
}

export function registerVideoGenerationRoutes(
  app: GatewayApp,
  recordAnalytics: RecordAnalytics
): void {
  app.openapi(videosGenRoute, async (context) => {
    const body = context.req.valid('json');
    const requestId = createRequestId();
    const headerProjectId = context.req.header('x-gateway-project-id') ?? undefined;
    const projectId = resolveProjectId(headerProjectId, body.project_id);
    if (!projectId) {
      return context.json(invalidProjectIdError(), 400);
    }

    const registry = filterVideoRegistry(context.env, body.model);
    if (registry.length === 0) {
      return context.json(noVideoProviderError(), 503);
    }

    const chosen = registry.sort((a, b) => b.priority - a.priority)[0];
    const costBudget = new CostBudget({ maxAttempts: 1, maxTotalTimeoutMs: 30_000 });
    costBudget.recordAttempt(30_000);

    try {
      const submitter = videoProviderCallers[chosen.provider].submit;
      const job = await submitter({
        env: context.env,
        model: chosen.model,
        prompt: body.prompt,
        duration_seconds: body.duration_seconds,
        aspect_ratio: body.aspect_ratio,
        image_url: body.image_url,
      });

      const statusCode = job.status === 'completed' ? 200 : 202;
      context.executionCtx.waitUntil(
        recordAnalytics({
          db: context.env.GATEWAY_DB,
          projectId,
          outcome: job.status === 'failed' ? 'error' : 'ok',
          provider: chosen.provider,
          model: chosen.model,
        })
      );

      await persistVideoJobMeta(context.env, job, chosen, projectId);

      return context.json(buildVideoGenSuccessBody(job, chosen, requestId, projectId), statusCode);
    } catch (error) {
      const failureClass = classifyError(error);
      context.executionCtx.waitUntil(
        recordAnalytics({
          db: context.env.GATEWAY_DB,
          projectId,
          outcome: 'error',
          provider: chosen.provider,
          model: chosen.model,
        })
      );
      const errorStatus =
        failureClass === 'input_nonretriable'
          ? 400
          : failureClass === 'usage_retriable'
            ? 429
            : 502;
      return context.json(buildVideoGenErrorBody(error, failureClass, costBudget), errorStatus);
    }
  });

  app.openapi(videosPollRoute, async (context) => {
    const { id } = context.req.valid('param');
    const meta = await loadVideoJobMeta(context.env, id);
    const { provider, model, projectId } = meta;

    if (!hasVideoProviderKey(context.env, provider)) {
      return context.json(noVideoProviderError(), 503);
    }

    try {
      const poller = videoProviderCallers.together.poll;
      const job = await poller(context.env, id);
      return context.json(
        buildVideoPollSuccessBody(job, provider, model, createRequestId(), projectId),
        200
      );
    } catch (error) {
      return context.json(buildVideoPollErrorBody(error), 501);
    }
  });
}
