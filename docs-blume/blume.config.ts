import { defineConfig } from 'blume';

// Blume is the PRESENTATION + SEARCH layer for the repository knowledge tree.
// The source of truth is the committed Markdown in ../docs — never edit
// generated Blume output. See ../docs/index.md for documentation maintenance
// rules.
export default defineConfig({
  title: 'AI Gateway — Knowledge',
  description:
    'Maintainer and agent documentation for the free-ai OpenAI-compatible LLM gateway: architecture, operations, learnings, and decisions.',
  content: { root: '../docs' },
  github: {
    owner: 'sass-maker',
    repo: 'free-ai',
    branch: 'main',
    dir: 'docs',
  },
  search: { provider: 'orama' },
  ai: { llmsTxt: true },
  seo: { agentReadability: true, sitemap: true, robots: true },
  deployment: {
    site: 'https://docs.ai-gateway.sassmaker.com',
    output: 'static',
  },
});
