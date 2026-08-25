/**
 * Portable agent-edge handler — copy or generate into each product.
 * Spec: fleet-ops/docs/agent-indexing-standard.md
 *
 * Usage in worker.mjs (before openNext.fetch):
 *   import { handleAgentEdge } from './agent-edge.mjs'
 *   const agent = handleAgentEdge(request)
 *   if (agent) return agent
 */

/** @type {{ name: string, url: string, llmsTxt: string, llmsFullTxt?: string, indexMd: string, catalog: object }} */
// biome-ignore format: generated payload from apply-agent-surfaces (JSON keys/quotes)
export const AGENT_SURFACE = {
  "name": "AI Gateway",
  "url": "https://ai-gateway.sassmaker.com",
  "llmsFullTxt": "# AI Gateway — full agent brief\n\nOpenAI-compatible LLM gateway fronting free-tier models across multiple providers.\n\n## Index\n\n# AI Gateway (free-ai)\n\nOpenAI-compatible gateway over free-tier models across providers.\n\n## API\n\n- Base: https://ai-gateway.sassmaker.com\n- `GET /health`\n- `GET /v1/models`\n- Chat completions require API key (`GATEWAY_API_KEY`)\n\n## Agent entrypoints\n\n- https://ai-gateway.sassmaker.com/llms.txt\n- https://ai-gateway.sassmaker.com/api/ai\n- https://ai-gateway.sassmaker.com/index.md\n\n## Product links\n\n- Health: https://ai-gateway.sassmaker.com/health — Health probe\n- Models: https://ai-gateway.sassmaker.com/v1/models — OpenAI-compatible models list\n\n## Machine surfaces\n\n- https://ai-gateway.sassmaker.com/llms.txt\n- https://ai-gateway.sassmaker.com/llms-full.txt\n- https://ai-gateway.sassmaker.com/api/ai\n- https://ai-gateway.sassmaker.com/index.md\n- https://ai-gateway.sassmaker.com/sitemap.xml\n- https://ai-gateway.sassmaker.com/robots.txt\n\n## Contact / fleet\n\n- Fleet: https://sassmaker.com\n- Agent email for directory verification: sarthakagrawal@agentmail.to\n",
  "llmsTxt": "# AI Gateway\n\n> OpenAI-compatible LLM gateway fronting free-tier models across multiple providers.\n\n## Product\n\n- [Health](https://ai-gateway.sassmaker.com/health): Health probe\n- [Models](https://ai-gateway.sassmaker.com/v1/models): OpenAI-compatible models list\n- [FAQ](https://ai-gateway.sassmaker.com/faq): Frequently asked questions about the gateway\n\n## Machine surfaces\n\n- [Agent catalog](https://ai-gateway.sassmaker.com/api/ai): JSON inventory of public surfaces\n- [OpenAPI spec](https://ai-gateway.sassmaker.com/openapi.json): Machine-readable API description\n- [Homepage markdown](https://ai-gateway.sassmaker.com/index.md): Product brief without JS\n- [This index](https://ai-gateway.sassmaker.com/llms.txt)\n\n## When to use this\n\n- Routing LLM requests across free-tier providers with an OpenAI-compatible API\n- Discovering available free-tier chat, embedding, image, and audio models\n- Checking gateway health, model availability, and provider quota status\n- Building agent workflows that need a zero-cost LLM gateway with fallback routing\n\n## Optional\n\n- [Foundry](https://sassmaker.com): Parent fleet showcase\n",
  "indexMd": "# AI Gateway (free-ai)\n\nOpenAI-compatible gateway over free-tier models across providers.\n\n## API\n\n- Base: https://ai-gateway.sassmaker.com\n- `GET /health`\n- `GET /v1/models`\n- Chat completions require API key (`GATEWAY_API_KEY`)\n\n## Agent entrypoints\n\n- https://ai-gateway.sassmaker.com/llms.txt\n- https://ai-gateway.sassmaker.com/api/ai\n- https://ai-gateway.sassmaker.com/index.md\n",
  "catalog": {
    "name": "AI Gateway",
    "version": "1",
    "url": "https://ai-gateway.sassmaker.com",
    "llms": "https://ai-gateway.sassmaker.com/llms.txt",
    "llmsFull": "https://ai-gateway.sassmaker.com/llms-full.txt",
    "sitemap": "https://ai-gateway.sassmaker.com/sitemap.xml",
    "robots": "https://ai-gateway.sassmaker.com/robots.txt",
    "markdown": {
      "suffix": ".md",
      "negotiation": true
    },
    "surfaces": [
      {
        "id": "home",
        "url": "https://ai-gateway.sassmaker.com/",
        "md": "https://ai-gateway.sassmaker.com/index.md",
        "kind": "static",
        "description": "Product home"
      },
      {
        "id": "about",
        "url": "https://ai-gateway.sassmaker.com/about",
        "md": "https://ai-gateway.sassmaker.com/about.md",
        "kind": "static",
        "description": "Why the gateway exists and how it operates"
      },
      {
        "id": "analytics",
        "url": "https://ai-gateway.sassmaker.com/analytics",
        "md": "https://ai-gateway.sassmaker.com/analytics.md",
        "kind": "docs",
        "description": "Aggregated gateway usage reference"
      },
      {
        "id": "authentication",
        "url": "https://ai-gateway.sassmaker.com/authentication",
        "md": "https://ai-gateway.sassmaker.com/authentication.md",
        "kind": "docs",
        "description": "Gateway authentication reference"
      },
      {
        "id": "changelog",
        "url": "https://ai-gateway.sassmaker.com/changelog",
        "md": "https://ai-gateway.sassmaker.com/changelog.md",
        "kind": "static",
        "description": "Verified product updates"
      },
      {
        "id": "chat-completions",
        "url": "https://ai-gateway.sassmaker.com/chat-completions",
        "md": "https://ai-gateway.sassmaker.com/chat-completions.md",
        "kind": "docs",
        "description": "Chat completions API reference"
      },
      {
        "id": "dashboard",
        "url": "https://ai-gateway.sassmaker.com/dashboard",
        "md": "https://ai-gateway.sassmaker.com/dashboard.md",
        "kind": "docs",
        "sitemap": false,
        "description": "Public gateway dashboard reference"
      },
      {
        "id": "embeddings",
        "url": "https://ai-gateway.sassmaker.com/embeddings",
        "md": "https://ai-gateway.sassmaker.com/embeddings.md",
        "kind": "docs",
        "description": "Embeddings API reference"
      },
      {
        "id": "error-handling",
        "url": "https://ai-gateway.sassmaker.com/error-handling",
        "md": "https://ai-gateway.sassmaker.com/error-handling.md",
        "kind": "docs",
        "description": "Gateway error handling reference"
      },
      {
        "id": "faq",
        "url": "https://ai-gateway.sassmaker.com/faq",
        "md": "https://ai-gateway.sassmaker.com/faq.md",
        "kind": "static",
        "description": "Frequently asked questions"
      },
      {
        "id": "getting-started",
        "url": "https://ai-gateway.sassmaker.com/getting-started",
        "md": "https://ai-gateway.sassmaker.com/getting-started.md",
        "kind": "docs",
        "description": "Gateway setup guide"
      },
      {
        "id": "health",
        "url": "https://ai-gateway.sassmaker.com/health",
        "md": "https://ai-gateway.sassmaker.com/health.md",
        "kind": "docs",
        "sitemap": false,
        "description": "Health endpoint reference"
      },
      {
        "id": "images",
        "url": "https://ai-gateway.sassmaker.com/images",
        "md": "https://ai-gateway.sassmaker.com/images.md",
        "kind": "docs",
        "description": "Image generation API reference"
      },
      {
        "id": "models",
        "url": "https://ai-gateway.sassmaker.com/models",
        "md": "https://ai-gateway.sassmaker.com/models.md",
        "kind": "docs",
        "sitemap": false,
        "description": "Model catalog reference"
      },
      {
        "id": "provider-stats",
        "url": "https://ai-gateway.sassmaker.com/provider-stats",
        "md": "https://ai-gateway.sassmaker.com/provider-stats.md",
        "kind": "docs",
        "description": "Provider telemetry reference"
      },
      {
        "id": "rate-limiting",
        "url": "https://ai-gateway.sassmaker.com/rate-limiting",
        "md": "https://ai-gateway.sassmaker.com/rate-limiting.md",
        "kind": "docs",
        "description": "Rate limiting reference"
      },
      {
        "id": "responses-api",
        "url": "https://ai-gateway.sassmaker.com/responses-api",
        "md": "https://ai-gateway.sassmaker.com/responses-api.md",
        "kind": "docs",
        "description": "Responses API reference"
      },
      {
        "id": "speech-to-speech",
        "url": "https://ai-gateway.sassmaker.com/speech-to-speech",
        "md": "https://ai-gateway.sassmaker.com/speech-to-speech.md",
        "kind": "docs",
        "description": "Speech-to-speech API reference"
      },
      {
        "id": "speech-to-text",
        "url": "https://ai-gateway.sassmaker.com/speech-to-text",
        "md": "https://ai-gateway.sassmaker.com/speech-to-text.md",
        "kind": "docs",
        "description": "Speech-to-text API reference"
      },
      {
        "id": "status",
        "url": "https://ai-gateway.sassmaker.com/status",
        "md": "https://ai-gateway.sassmaker.com/status.md",
        "kind": "static",
        "description": "Human-readable gateway status"
      },
      {
        "id": "text-to-speech",
        "url": "https://ai-gateway.sassmaker.com/text-to-speech",
        "md": "https://ai-gateway.sassmaker.com/text-to-speech.md",
        "kind": "docs",
        "description": "Text-to-speech API reference"
      },
      {
        "id": "videos",
        "url": "https://ai-gateway.sassmaker.com/videos",
        "md": "https://ai-gateway.sassmaker.com/videos.md",
        "kind": "docs",
        "description": "Video generation API reference"
      }
    ],
    "apiResources": [
      {
        "id": "health-json",
        "url": "https://ai-gateway.sassmaker.com/health",
        "mediaType": "application/json",
        "auth": "public"
      },
      {
        "id": "models-json",
        "url": "https://ai-gateway.sassmaker.com/v1/models",
        "mediaType": "application/json",
        "auth": "public"
      },
      {
        "id": "provider-stats-json",
        "url": "https://ai-gateway.sassmaker.com/v1/stats/providers",
        "mediaType": "application/json",
        "auth": "public"
      },
      {
        "id": "routing-status-json",
        "url": "https://ai-gateway.sassmaker.com/v1/routing/status",
        "mediaType": "application/json",
        "auth": "public"
      },
      {
        "id": "openapi",
        "url": "https://ai-gateway.sassmaker.com/openapi.json",
        "mediaType": "application/json",
        "auth": "public"
      }
    ],
    "auth": {
      "public": true,
      "notes": "Only the listed documentation, status, and aggregate read-only resources are public. Token-spending and project-scoped API routes require a gateway key and are excluded."
    }
  }
};

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'AI Gateway public API',
    version: '1.0.0',
    description:
      'OpenAI-compatible LLM gateway fronting free-tier models across multiple providers. The public web API exposes read-only agent surfaces: the agent catalog, llms.txt, sitemap, and markdown alternates.',
    contact: { name: 'AI Gateway', url: 'https://ai-gateway.sassmaker.com' },
  },
  servers: [{ url: 'https://ai-gateway.sassmaker.com' }],
  tags: [{ name: 'agent-surfaces', description: 'Machine-readable public surfaces' }],
  paths: {
    '/api/ai': {
      get: {
        operationId: 'getAgentCatalog',
        tags: ['agent-surfaces'],
        summary: 'Agent catalog',
        description: 'JSON inventory of public agent surfaces.',
        responses: {
          200: {
            description: 'Agent catalog',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AgentCatalog' } },
            },
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        operationId: 'getLlmsTxt',
        tags: ['agent-surfaces'],
        summary: 'llms.txt index',
        responses: { 200: { description: 'Markdown index', content: { 'text/plain': {} } } },
      },
    },
    '/llms-full.txt': {
      get: {
        operationId: 'getLlmsFullTxt',
        tags: ['agent-surfaces'],
        summary: 'Full agent brief',
        responses: { 200: { description: 'Markdown brief', content: { 'text/plain': {} } } },
      },
    },
    '/sitemap.xml': {
      get: {
        operationId: 'getSitemap',
        tags: ['agent-surfaces'],
        summary: 'Sitemap',
        responses: { 200: { description: 'XML sitemap', content: { 'application/xml': {} } } },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        tags: ['agent-surfaces'],
        summary: 'OpenAPI specification',
        description: 'This document.',
        responses: {
          200: { description: 'OpenAPI 3.1 spec', content: { 'application/json': {} } },
        },
      },
    },
  },
  components: {
    schemas: {
      AgentCatalog: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          llms: { type: 'string', format: 'uri' },
          llmsFull: { type: 'string', format: 'uri' },
          sitemap: { type: 'string', format: 'uri' },
          robots: { type: 'string', format: 'uri' },
          openapi: { type: 'string', format: 'uri' },
          markdown: {
            type: 'object',
            properties: { suffix: { type: 'string' }, negotiation: { type: 'boolean' } },
          },
        },
      },
    },
  },
};

function jsonError(status, code, message, path) {
  return new Response(JSON.stringify({ error: { code, message, path } }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function markdown404(pathname, origin) {
  const body = `# 404 — Not Found

\`${pathname}\` does not exist on ${origin}.

## Where to look next

- [Home](${origin}/)
- [Sitemap](${origin}/sitemap.xml)
- [Agent index](${origin}/llms.txt)
- [Full agent brief](${origin}/llms-full.txt)
- [Agent catalog (JSON)](${origin}/api/ai)
`;
  return new Response(body, {
    status: 404,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
}

function staticAgentResponse(path) {
  if (path === '/openapi.json' || path === '/openapi.yaml') {
    return new Response(JSON.stringify(OPENAPI_SPEC, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600',
      },
    });
  }
  if (path === '/llms.txt') return text(AGENT_SURFACE.llmsTxt, 'text/plain; charset=utf-8');
  if (path === '/llms-full.txt' && AGENT_SURFACE.llmsFullTxt) {
    return text(AGENT_SURFACE.llmsFullTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/index.md') return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8');
  return null;
}

function agentCatalog(origin) {
  return {
    ...AGENT_SURFACE.catalog,
    url: origin,
    llms: `${origin}/llms.txt`,
    llmsFull: `${origin}/llms-full.txt`,
    sitemap: rebindOrigin(AGENT_SURFACE.catalog.sitemap, origin),
    robots: rebindOrigin(AGENT_SURFACE.catalog.robots, origin),
    openapi: `${origin}/openapi.json`,
    surfaces: (AGENT_SURFACE.catalog.surfaces || []).map((surface) => ({
      ...surface,
      url: rebindOrigin(surface.url, origin),
      md: rebindOrigin(surface.md, origin),
    })),
    apiResources: (AGENT_SURFACE.catalog.apiResources || []).map((resource) => ({
      ...resource,
      url: rebindOrigin(resource.url, origin),
    })),
  };
}

function negotiatedMarkdown(request, path, origin) {
  if (!wantsMarkdown(request)) return null;
  if (path === '/') {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8', {
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
      Vary: 'Accept, Accept-Encoding',
    });
  }
  if (!path.includes('.') && !path.startsWith('/api/')) return markdown404(path, origin);
  return null;
}

/**
 * @param {Request} request
 * @returns {Response | null}
 */
export function handleAgentEdge(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname === '' ? '/' : url.pathname;

  const staticResponse = staticAgentResponse(path);
  if (staticResponse) return staticResponse;
  if (path === '/api/ai') return json(agentCatalog(url.origin));

  if (path.startsWith('/api/') && path !== '/api/ai') {
    return jsonError(404, 'not_found', `Unknown API path: ${path}`, path);
  }
  return negotiatedMarkdown(request, path, url.origin);
}

function rebindOrigin(value, origin) {
  if (!value) return value;
  const source = new URL(String(value), AGENT_SURFACE.url);
  return `${origin}${source.pathname}${source.search}${source.hash}`;
}

function text(body, type, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300',
      ...extra,
    },
  });
}

function json(data) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
