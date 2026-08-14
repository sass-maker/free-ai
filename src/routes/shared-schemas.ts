import { type OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env, Provider } from '../types';

export type GatewayApp = OpenAPIHono<{ Bindings: Env }>;

export type RecordAnalytics = (params: {
  db: D1Database;
  projectId?: string;
  outcome: 'ok' | 'error';
  provider?: Provider;
  model?: string;
}) => Promise<void>;

export const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._:-]+$/);

export const gatewayMetaSchema = z.object({
  provider: z.string(),
  model: z.string(),
  attempts: z.number().int().min(1),
  reasoning_effort: z.enum(['auto', 'low', 'medium', 'high']),
  request_id: z.string(),
  project_id: z.string().optional(),
});

export const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
});
