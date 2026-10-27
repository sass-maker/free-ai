import pages from './public-runtime-pages.json';
import { identity } from '../site/src/data/site-identity.mjs';

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
/** Metadata only: the authored visible body and browser behavior stay intact. */
export function publicRuntimeHtml(html: string, canonicalPath: string, requestedPath: string) {
  const page = pages.find((page) => page.path === canonicalPath);
  if (!page) throw new Error('Unregistered public runtime HTML');
  const duplicate =
    page.htmlAliases.includes(requestedPath) || requestedPath === `${canonicalPath}/`;
  const signals = `<link rel="canonical" href="${identity.url}${canonicalPath}"><link rel="alternate" type="text/markdown" href="${identity.url}${canonicalPath}.md"><meta name="description" content="${escape(page.description)}"><meta name="ai-summary" content="${escape(page.description)}">${duplicate ? '<meta name="robots" content="noindex, follow">' : ''}`;
  return html.replace('</head>', `${signals}</head>`);
}
