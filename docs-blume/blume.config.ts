import { defineConfig } from 'blume';

// Blume is the presentation + search layer for the public API reference.
// The source of truth is the committed Markdown in ../site/src/content/docs.
export default defineConfig({
  title: 'AI Gateway — API Docs',
  description:
    'Public API documentation for the free-ai OpenAI-compatible LLM gateway.',
  content: { root: '../site/src/content/docs' },
  github: {
    owner: 'sass-maker',
    repo: 'free-ai',
    branch: 'main',
    dir: 'site/src/content/docs',
  },
  search: { provider: 'orama' },
  ai: { llmsTxt: true },
  seo: { agentReadability: true, sitemap: true, robots: true },
  deployment: {
    site: 'https://ai-gateway.sassmaker.com',
    base: '/docs',
    output: 'static',
  },
});
