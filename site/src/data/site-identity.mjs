import { publicPageMeta } from './public-content.mjs';
const origin = publicPageMeta.origin;
export const identity = {
  name: 'Free AI',
  url: origin,
  summary: publicPageMeta.index.description,
  trainingAllowed: true,
  updatedAt: '2026-10-26',
  openapi: `${origin}/openapi.json`,
  excludedPaths: ['/api (except discovery and Markdown)', '/v1', '/admin', '/auth'],
  notes: [
    'Live status is rendered from public model and provider APIs. Full exports omit live runtime views; static files are build-time content. Private browser-local state and experiment mutations are excluded.',
  ],
  sitemap: `${origin}/sitemap.xml`,
};

export const organizationJsonLd = {
  '@type': 'Organization',
  '@id': `${identity.url}/#organization`,
  name: identity.name,
  url: identity.url,
  description: identity.summary,
  logo: `${identity.url}/icon.svg`,
  sameAs: ['https://github.com/sass-maker/free-ai'],
};
