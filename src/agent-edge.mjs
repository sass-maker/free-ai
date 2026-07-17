/**
 * Portable agent-edge handler — copy or generate into each product.
 * Spec: fleet-ops/docs/agent-indexing-standard.md
 *
 * Usage in worker.mjs (before openNext.fetch):
 *   import { handleAgentEdge } from './agent-edge.mjs'
 *   const agent = handleAgentEdge(request)
 *   if (agent) return agent
 */

/** @type {{ name: string, url: string, llmsTxt: string, indexMd: string, catalog: object, llmsFull?: string | null }} */
export const AGENT_SURFACE = {
  "name": "AI Gateway",
  "url": "https://ai-gateway.sassmaker.com",
  "llmsTxt": "# AI Gateway\n\n> OpenAI-compatible LLM gateway fronting free-tier models across multiple providers.\n\n## Product\n\n- [Health](https://ai-gateway.sassmaker.com/health): Health probe\n- [Models](https://ai-gateway.sassmaker.com/v1/models): OpenAI-compatible models list\n\n## Machine surfaces\n\n- [Agent catalog](https://ai-gateway.sassmaker.com/api/ai): JSON inventory of public surfaces\n- [Homepage markdown](https://ai-gateway.sassmaker.com/index.md): Product brief without JS\n- [This index](https://ai-gateway.sassmaker.com/llms.txt)\n\n## Optional\n\n- [Foundry](https://sassmaker.com): Parent fleet showcase\n",
  "indexMd": "# AI Gateway (free-ai)\n\nOpenAI-compatible gateway over free-tier models across providers.\n\n## API\n\n- Base: https://ai-gateway.sassmaker.com\n- `GET /health`\n- `GET /v1/models`\n- Chat completions require API key (`GATEWAY_API_KEY`)\n\n## Agent entrypoints\n\n- https://ai-gateway.sassmaker.com/llms.txt\n- https://ai-gateway.sassmaker.com/api/ai\n- https://ai-gateway.sassmaker.com/index.md\n",
  "catalog": {
    "name": "AI Gateway",
    "version": "1",
    "url": "https://ai-gateway.sassmaker.com",
    "llms": "https://ai-gateway.sassmaker.com/llms.txt",
    "llmsFull": null,
    "sitemap": "https://ai-gateway.sassmaker.com/sitemap.xml",
    "markdown": {
      "suffix": ".md",
      "negotiation": true
    },
    "surfaces": [
      {
        "id": "home",
        "url": "https://ai-gateway.sassmaker.com/",
        "md": "https://ai-gateway.sassmaker.com/index.md",
        "kind": "spa",
        "description": "Product home"
      },
      {
        "id": "health",
        "url": "https://ai-gateway.sassmaker.com/health",
        "md": null,
        "kind": "static",
        "description": "Health probe"
      },
      {
        "id": "models",
        "url": "https://ai-gateway.sassmaker.com/v1/models",
        "md": null,
        "kind": "static",
        "description": "OpenAI-compatible models list"
      }
    ],
    "auth": {
      "public": true,
      "notes": "Auth-walled app routes are not agent-indexed unless listed here."
    }
  },
  "llmsFull": null
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
  if (path === '/llms-full.txt' && AGENT_SURFACE.llmsFull) {
    return text(AGENT_SURFACE.llmsFull, 'text/plain; charset=utf-8');
  }
  if (path === '/index.md') {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8');
  }
  if (path === '/api/ai') {
    // Re-bind origin so preview/custom domains stay correct
    const catalog = {
      ...AGENT_SURFACE.catalog,
      url: url.origin,
      llms: `${url.origin}/llms.txt`,
      sitemap: AGENT_SURFACE.catalog.sitemap
        ? String(AGENT_SURFACE.catalog.sitemap).replace(AGENT_SURFACE.url, url.origin)
        : `${url.origin}/sitemap.xml`,
      surfaces: (AGENT_SURFACE.catalog.surfaces || []).map((s) => ({
        ...s,
        url: s.url ? String(s.url).replace(AGENT_SURFACE.url, url.origin) : s.url,
        md: s.md ? String(s.md).replace(AGENT_SURFACE.url, url.origin) : s.md,
      })),
    };
    return json(catalog);
  }

  // Homepage markdown negotiation
  if ((path === '/' || path === '') && wantsMarkdown(request)) {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8', {
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
      Vary: 'Accept',
    });
  }

  return null;
}

function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
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
