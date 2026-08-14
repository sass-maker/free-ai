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
  "llmsTxt": "# AI Gateway\n\n> OpenAI-compatible LLM gateway fronting free-tier models across multiple providers.\n\n## Product\n\n- [Health](https://ai-gateway.sassmaker.com/health): Health probe\n- [Models](https://ai-gateway.sassmaker.com/v1/models): OpenAI-compatible models list\n\n## Machine surfaces\n\n- [Agent catalog](https://ai-gateway.sassmaker.com/api/ai): JSON inventory of public surfaces\n- [Homepage markdown](https://ai-gateway.sassmaker.com/index.md): Product brief without JS\n- [This index](https://ai-gateway.sassmaker.com/llms.txt)\n\n## Optional\n\n- [Foundry](https://sassmaker.com): Parent fleet showcase\n",
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
      "negotiation": false
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

/**
 * @param {Request} request
 * @returns {Response | null}
 */
export function handleAgentEdge(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname === '' ? '/' : url.pathname;

  if (path === '/llms.txt') {
    return text(AGENT_SURFACE.llmsTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/llms-full.txt' && AGENT_SURFACE.llmsFullTxt) {
    return text(AGENT_SURFACE.llmsFullTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/api/ai') {
    // Re-bind origin so preview/custom domains stay correct
    const catalog = {
      ...AGENT_SURFACE.catalog,
      url: url.origin,
      llms: `${url.origin}/llms.txt`,
      llmsFull: `${url.origin}/llms-full.txt`,
      sitemap: rebindOrigin(AGENT_SURFACE.catalog.sitemap, url.origin),
      robots: rebindOrigin(AGENT_SURFACE.catalog.robots, url.origin),
      surfaces: (AGENT_SURFACE.catalog.surfaces || []).map((s) => ({
        ...s,
        url: rebindOrigin(s.url, url.origin),
        md: rebindOrigin(s.md, url.origin),
      })),
      apiResources: (AGENT_SURFACE.catalog.apiResources || []).map((resource) => ({
        ...resource,
        url: rebindOrigin(resource.url, url.origin),
      })),
    };
    return json(catalog);
  }

  return null;
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
