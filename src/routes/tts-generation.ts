import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import { getTtsRegistry, hasTtsProviderKey } from '../config';
import { ttsProviderCallers } from '../providers';
import { TtsBudgetError, TtsInputError } from '../providers/workers-ai-tts';
import { buildBudgetExhaustedResponse } from '../state/neuron-budget';
import type { Env, Provider } from '../types';
import { getErrorMessage } from '../utils/request';
import { sortFallbackLast } from './provider-order';
import {
  type GatewayApp,
  type RecordAnalytics,
  errorSchema,
  projectIdSchema,
} from './shared-schemas';

type TtsRouteContext = Context<{ Bindings: Env }>;

const ttsRequestSchema = z
  .object({
    model: z.string().default('auto'),
    input: z.string().min(1).max(3000),
    voice: z.string().optional(),
    response_format: z.enum(['mp3', 'wav', 'opus', 'flac']).optional(),
    speed: z.number().min(0.25).max(4.0).optional(),
    project_id: projectIdSchema.optional(),
  })
  .openapi('TtsRequest');

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
    502: {
      description: 'Provider failure',
      content: { 'application/json': { schema: errorSchema } },
    },
    503: {
      description: 'No TTS provider',
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

function invalidProjectIdResponse() {
  return {
    error: {
      message: 'Missing or invalid project_id. Use 1-64 chars [a-zA-Z0-9._:-]',
      type: 'invalid_request_error',
      code: 'invalid_project_id',
    },
  };
}

function noTtsProviderResponse() {
  return {
    error: {
      message: 'TTS unavailable: no GROQ_API_KEY and Workers AI binding missing',
      type: 'configuration_error',
      code: 'no_tts_provider',
    },
  };
}

function filterTtsRegistry(
  env: Env,
  forcedProvider: string | undefined,
  requestedModel: string,
  requestedLower: string
) {
  return getTtsRegistry(env).filter((candidate) => {
    if (forcedProvider && candidate.provider !== forcedProvider) return false;
    if (
      requestedModel &&
      requestedLower !== 'auto' &&
      candidate.model !== requestedModel &&
      candidate.id !== requestedModel
    ) {
      return false;
    }
    return hasTtsProviderKey(env, candidate.provider);
  });
}

async function tryTtsCandidate(
  context: TtsRouteContext,
  candidate: { provider: string; model: string },
  body: {
    input: string;
    voice?: string;
    response_format?: 'mp3' | 'wav' | 'opus' | 'flac';
    speed?: number;
  }
): Promise<{ audio: BodyInit; contentType: string } | { error: Error }> {
  try {
    const caller = ttsProviderCallers[candidate.provider as 'groq' | 'workers_ai'];
    const result = await caller({
      env: context.env,
      model: candidate.model,
      input: body.input,
      voice: body.voice,
      response_format: body.response_format,
      speed: body.speed,
    });
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(getErrorMessage(error)) };
  }
}

export function registerTtsGenerationRoute(
  app: GatewayApp,
  recordAnalytics: RecordAnalytics
): void {
  app.openapi(audioSpeechRoute, async (context) => {
    const body = context.req.valid('json');
    const headerProjectId = context.req.header('x-gateway-project-id') ?? undefined;
    const projectId = resolveProjectId(headerProjectId, body.project_id);
    if (!projectId) {
      return context.json(invalidProjectIdResponse(), 400);
    }

    const forcedProvider = context.req.header('x-gateway-force-provider') ?? undefined;
    const requestedModel = body.model.trim();
    const requestedLower = requestedModel.toLowerCase();
    const registry = filterTtsRegistry(context.env, forcedProvider, requestedModel, requestedLower);

    if (registry.length === 0) {
      return context.json(noTtsProviderResponse(), 503);
    }

    const sorted = sortFallbackLast(registry, !forcedProvider && requestedLower === 'auto');
    let lastError = new Error('Unknown error');
    let lastProviderError: Error | undefined;
    let chosenProvider: string | undefined;
    let chosenModel: string | undefined;
    let ttsAttempts = 0;

    for (const candidate of sorted) {
      chosenProvider = candidate.provider;
      chosenModel = candidate.model;
      ttsAttempts += 1;

      const outcome = await tryTtsCandidate(context, candidate, body);
      if (!('error' in outcome)) {
        context.executionCtx.waitUntil(
          recordAnalytics({
            db: context.env.GATEWAY_DB,
            projectId,
            outcome: 'ok',
            provider: candidate.provider,
            model: candidate.model,
          })
        );

        const degraded = ttsAttempts > 1;
        return new Response(outcome.audio, {
          headers: {
            'content-type': outcome.contentType,
            'x-gateway-provider': candidate.provider,
            'x-gateway-model': candidate.model,
            'x-gateway-project-id': projectId,
            ...(degraded ? { 'x-degraded-mode': 'true' } : {}),
          },
        });
      }
      lastError = outcome.error;
      if (!(outcome.error instanceof TtsInputError)) lastProviderError = outcome.error;
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
    // A fallback's narrower options must not mask a provider failure for valid input.
    lastError = lastProviderError ?? lastError;
    if (lastError instanceof TtsBudgetError) return buildBudgetExhaustedResponse(lastError.debit);
    if (lastError instanceof TtsInputError) {
      return context.json(
        {
          error: {
            message: lastError.message,
            type: 'invalid_request_error',
            code: lastError.code,
          },
        },
        400
      );
    }
    return context.json(
      {
        error: {
          message: `All TTS providers failed: ${lastError.message}`,
          type: 'provider_error',
        },
      },
      502
    );
  });
}
