// Shared test helpers: builds a minimal fake Env + ExecutionContext so
// Hono routes can be driven with `app.fetch(req, env, ctx)` without any real
// Cloudflare bindings.

import { vi } from 'vitest';

// Minimal DurableObject stub. The rate-limit + health routes in the worker
// call into HEALTH_DO / RATE_LIMIT_DO via `idFromName(...).fetch(path)`.
// We route by pathname and return JSON shaped like the real implementations.
function makeDoNamespace(handler: (path: string, init?: RequestInit) => Promise<Response> | Response) {
  return {
    idFromName: (_name: string) => ({ name: _name }),
    idFromString: (_s: string) => ({ _s }),
    newUniqueId: () => ({}),
    get: (_id: unknown) => ({
      fetch: async (url: string | Request, init?: RequestInit) => {
        const path = typeof url === 'string' ? new URL(url).pathname : new URL((url as Request).url).pathname;
        return handler(path, init);
      },
    }),
  } as unknown as DurableObjectNamespace;
}

export interface FakeEnvOverrides {
  TOGETHER_API_KEY?: string;
  GATEWAY_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKERS_AI_API_KEY?: string;
  WORKERS_AI_ENABLED?: string;
  kv?: Map<string, string>;
  providerStats?: unknown[];
  // Allow tests to simulate rate-limit denials
  rateLimitDeny?: boolean;
}

export function makeTestEnv(overrides: FakeEnvOverrides = {}) {
  const kv = overrides.kv ?? new Map<string, string>();

  const HEALTH_KV = {
    get: vi.fn(async (key: string, _type?: string) => {
      const raw = kv.get(key);
      if (raw === undefined) return null;
      if (_type === 'json') {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      kv.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      kv.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [] })),
  } as unknown as KVNamespace;

  const HEALTH_DO = makeDoNamespace(async (path) => {
    if (path === '/lookup') {
      return Response.json({ snapshots: [] });
    }
    if (path === '/snapshot') {
      return Response.json({ snapshots: [] });
    }
    if (path === '/providers/stats') {
      return Response.json({ stats: overrides.providerStats ?? [] });
    }
    if (path === '/round-robin-next') {
      return Response.json({ offset: 0 });
    }
    if (path === '/record') {
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  });

  const RATE_LIMIT_DO = makeDoNamespace(async (path) => {
    if (path === '/consume') {
      return Response.json({
        allowed: !overrides.rateLimitDeny,
        remaining: overrides.rateLimitDeny ? 0 : 100,
        retryAfter: overrides.rateLimitDeny ? 1 : 0,
      });
    }
    return new Response('not found', { status: 404 });
  });

  const GATEWAY_DB = {
    prepare: vi.fn(() => ({
      bind: vi.fn(function (this: unknown) {
        return this;
      }),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    })),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
    dump: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as D1Database;

  const env = {
    GATEWAY_DB,
    HEALTH_DO,
    RATE_LIMIT_DO,
    HEALTH_KV,
    GATEWAY_API_KEY: overrides.GATEWAY_API_KEY ?? 'test-gateway-key',
    TOGETHER_API_KEY: overrides.TOGETHER_API_KEY,
    GEMINI_API_KEY: overrides.GEMINI_API_KEY,
    GROQ_API_KEY: overrides.GROQ_API_KEY,
    NVIDIA_API_KEY: overrides.NVIDIA_API_KEY,
    CLOUDFLARE_ACCOUNT_ID: overrides.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_WORKERS_AI_API_KEY: overrides.CLOUDFLARE_WORKERS_AI_API_KEY,
    WORKERS_AI_ENABLED: overrides.WORKERS_AI_ENABLED,
  };

  return { env, kv };
}

export function makeCtx() {
  return {
    waitUntil: (_p: Promise<unknown> | unknown) => {
      // Swallow: tests don't depend on background tasks finishing.
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}
