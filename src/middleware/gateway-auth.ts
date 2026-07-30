import type { OpenAPIHono } from '@hono/zod-openapi';

import { isGatewayAuthConfigured, isValidGatewayApiKey } from '../auth/gateway';
import { capture } from '../lib/telemetry';
import type { Env } from '../types';

type GatewayApp = OpenAPIHono<{ Bindings: Env }>;

const AUTH_EXEMPT_GET = new Set([
  '/v1/analytics',
  '/v1/routing/ledger',
  '/v1/stats/providers',
  '/v1/routing/status',
  '/v1/routing/config',
  '/v1/provider-quotas',
  '/v1/models',
  '/v1/dashboard',
  '/v1/budget',
  '/v1/benchmark/optimizer',
  '/benchmark',
  '/v1/benchmark',
]);

function captureAuthFailure(route: string, reason: string): void {
  capture({
    distinctId: 'free-ai',
    event: 'foundry_auth_failure',
    properties: {
      project_id: 'free-ai',
      route,
      stage: 'signin',
      reason,
      source: 'gateway-auth',
    },
  });
}

export function registerGatewayAuthMiddleware(app: GatewayApp): void {
  app.use('/v1/*', async (context, next) => {
    const route = new URL(context.req.url).pathname;
    const isExemptGet = context.req.method === 'GET' && AUTH_EXEMPT_GET.has(route);

    if (isExemptGet) {
      return next();
    }

    if (!isGatewayAuthConfigured(context.env)) {
      captureAuthFailure(route, 'GATEWAY_API_KEY missing');
      return context.json(
        {
          error: {
            message: 'Gateway API key is not configured',
            type: 'configuration_error',
            code: 'auth_not_configured',
          },
        },
        503
      );
    }

    const authHeader = context.req.header('authorization') ?? '';
    const providedKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (context.req.header('x-api-key') ?? '');

    if (!(await isValidGatewayApiKey(providedKey, context.env))) {
      captureAuthFailure(route, 'Invalid API key');
      return context.json(
        {
          error: {
            message: 'Unauthorized',
            type: 'authentication_error',
            code: 'invalid_api_key',
          },
        },
        401
      );
    }

    return next();
  });
}
