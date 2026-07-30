import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const origin = 'https://ai-gateway.sassmaker.com';
const socialImage = `${origin}/icon.svg`;
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://sassmaker.com/#org',
      name: 'SaaS Maker (Foundry)',
      url: 'https://sassmaker.com',
      sameAs: ['https://github.com/sass-maker/free-ai'],
    },
    {
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: 'sass-maker / AI Gateway',
      url: origin,
      description:
        'OpenAI-compatible AI gateway routing across free-tier providers with health-aware selection.',
      publisher: { '@id': 'https://sassmaker.com/#org' },
    },
  ],
};

export default defineConfig({
  site: origin,
  integrations: [
    starlight({
      title: 'sass-maker / AI Gateway',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/sass-maker/free-ai' }],
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
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: socialImage,
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: socialImage,
          },
        },
        {
          tag: 'script',
          attrs: { type: 'application/ld+json' },
          content: JSON.stringify(structuredData),
        },
      ],
    }),
  ],
});
