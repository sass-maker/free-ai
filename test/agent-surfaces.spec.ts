import { describe, expect, it } from 'vitest';
import { AGENT_SURFACE, handleAgentEdge } from '../src/agent-edge.mjs';

describe('agent surface catalog', () => {
  it('catalogs every canonical public HTML page with a same-origin Markdown target', async () => {
    const response = handleAgentEdge(
      new Request('https://preview.example.com/api/ai', {
        headers: { accept: 'application/json' },
      })
    );
    expect(response).not.toBeNull();

    const catalog = (await response?.json()) as typeof AGENT_SURFACE.catalog;
    expect(catalog.surfaces).toHaveLength(22);
    expect(new Set(catalog.surfaces.map((surface: { id: string }) => surface.id)).size).toBe(22);

    for (const surface of catalog.surfaces) {
      expect(new URL(surface.url).origin).toBe('https://preview.example.com');
      expect(new URL(surface.md).origin).toBe('https://preview.example.com');
      expect(new URL(surface.md).pathname).toMatch(/\.md$/);
      expect(new URL(surface.url).pathname).not.toMatch(/^\/(?:api|v1)\//);
    }
    for (const resource of catalog.apiResources) {
      expect(new URL(resource.url).origin).toBe('https://preview.example.com');
    }
    expect(new URL(catalog.sitemap).origin).toBe('https://preview.example.com');
    expect(new URL(catalog.robots).origin).toBe('https://preview.example.com');
  });

  it('keeps JSON/API resources outside the HTML surface list', () => {
    const htmlUrls = new Set(AGENT_SURFACE.catalog.surfaces.map((surface) => surface.url));
    expect(AGENT_SURFACE.catalog.apiResources).toHaveLength(5);
    expect(
      AGENT_SURFACE.catalog.apiResources.some((resource) => resource.url.endsWith('/v1/models'))
    ).toBe(true);
    expect(htmlUrls.has('https://ai-gateway.sassmaker.com/v1/models')).toBe(false);
    const sitemapSurfaces = AGENT_SURFACE.catalog.surfaces as Array<{
      id: string;
      sitemap?: boolean;
    }>;
    expect(
      sitemapSurfaces.filter((surface) => surface.sitemap === false).map((surface) => surface.id)
    ).toEqual(['dashboard', 'health', 'models']);
  });

  it('lets generated asset Markdown handle page alternates', () => {
    expect(
      handleAgentEdge(
        new Request('https://ai-gateway.sassmaker.com/index.md', {
          headers: { accept: 'text/markdown' },
        })
      )
    ).toBeNull();
    expect(
      handleAgentEdge(
        new Request('https://ai-gateway.sassmaker.com/authentication.md', {
          headers: { accept: 'text/markdown' },
        })
      )
    ).toBeNull();
  });
});
