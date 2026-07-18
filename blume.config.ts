import { defineConfig } from 'blume';

/**
 * Blume configuration for the free-ai docs site.
 *
 * The committed Markdown under docs/ is the source of truth. Blume is only
 * the presentation and search layer — generated output (.blume/) is
 * gitignored and never committed. See docs/development/workflow.md.
 */
export default defineConfig({
  title: 'free-ai docs',
  description:
    'Local-first knowledge system for free-ai — an OpenAI-compatible API gateway on Cloudflare Workers routing across 30+ free LLM providers with health-aware selection, rate limiting, and analytics.',

  content: {
    root: 'docs',
    include: ['**/*.md'],
  },

  theme: {
    accent: 'emerald',
    radius: 'md',
    mode: 'system',
  },

  search: {
    provider: 'orama',
  },

  markdown: {
    imageZoom: true,
    code: {
      icons: true,
      wrap: false,
    },
  },

  ai: {
    llmsTxt: true,
  },

  seo: {
    og: { enabled: true },
    sitemap: true,
    robots: true,
    structuredData: true,
  },

  deployment: {
    output: 'static',
    // Set this when the docs site is published.
    // site: "https://docs.free-ai.example",
  },
});
