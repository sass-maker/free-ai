import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'sass-maker / AI Gateway',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/sarthakagrawal/free-ai' },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'getting-started' },
            { label: 'Authentication', slug: 'authentication' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Chat Completions', slug: 'chat-completions' },
            { label: 'Responses API', slug: 'responses-api' },
            { label: 'Embeddings', slug: 'embeddings' },
            { label: 'Models', slug: 'models' },
          ],
        },
        {
          label: 'Multimodal',
          items: [
            { label: 'Image Generation', slug: 'images' },
            { label: 'Video Generation', slug: 'videos' },
            { label: 'Text-to-Speech', slug: 'text-to-speech' },
            { label: 'Speech-to-Text', slug: 'speech-to-text' },
            { label: 'Speech-to-Speech', slug: 'speech-to-speech' },
          ],
        },
        {
          label: 'Observability',
          items: [
            { label: 'Dashboard', slug: 'dashboard' },
            { label: 'Analytics', slug: 'analytics' },
            { label: 'Health', slug: 'health' },
            { label: 'Provider Stats', slug: 'provider-stats' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Error Handling', slug: 'error-handling' },
            { label: 'Rate Limiting', slug: 'rate-limiting' },
          ],
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'description',
            content:
              'OpenAI-compatible AI gateway routing across free-tier providers with health-aware selection.',
          },
        },
      ],
    }),
  ],
});
