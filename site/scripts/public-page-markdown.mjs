import { readFile } from 'node:fs/promises';
import { publicPageMeta, pageIntro } from '../src/data/public-content.mjs';
import { faqs } from '../src/content/public/faqs.mjs';
import { entries } from '../src/content/public/entries.mjs';
import { absoluteMarkdownLinks } from '../../src/lib/agent-surfaces/format.mjs';

// These authored fragments are imported by the Astro templates too. This
// renderer never reads built HTML or extracts a browser-rendered page.
export async function renderPublicPage(slug) {
  const key = slug.replace(/\/$/, '');
  const meta = publicPageMeta[key];
  if (!meta) throw new Error(`Missing public content source: ${slug}`);
  let body;
  if (key === 'index' || key === 'about') {
    const files =
      key === 'index' ? ['home-hero', 'home-proof', 'home-features', 'home-quickstart'] : ['about'];
    body = (
      await Promise.all(
        files.map(async (name) =>
          authoredHtmlToMarkdown(
            (
              await readFile(new URL(`../src/content/public/${name}.html`, import.meta.url), 'utf8')
            ).replaceAll('__ORIGIN__', publicPageMeta.origin)
          )
        )
      )
    ).join('\n\n');
  } else if (key === 'faq') {
    body = `${pageIntro.faq}\n\n${faqs.map(({ q, a }) => `## ${q}\n\n${a}`).join('\n\n')}`;
  } else if (key === 'changelog') {
    body =
      pageIntro.changelog +
      '\n\n' +
      entries
        .map(
          ({ date, title, body, tags }) => `## ${date}: ${title}\n\n${body}\n\n${tags.join(', ')}`
        )
        .join('\n\n');
  } else {
    body =
      'This build-time document does not contain live readings. Current model and provider readings are available from [models](/v1/models) and [provider stats](/v1/stats/providers). The HTML status page refreshes these public sources every 30 seconds.';
  }
  const canonical = new URL(key === 'index' ? '/' : `/${key}/`, publicPageMeta.origin).href;
  return absoluteMarkdownLinks(
    `# ${meta.title}\n\n> ${meta.description}\n\nSource: ${canonical}\n\n${body}\n`,
    canonical
  );
}

export function authoredHtmlToMarkdown(source) {
  const blocks = [];
  const text = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<div[^>]*id="proof-requests"[^>]*>[\s\S]*?<\/div>/g,
      '<p>Build-time snapshot: live request count unavailable.</p>'
    )
    .replace(
      /<div[^>]*id="proof-savings"[^>]*>[\s\S]*?<\/div>/g,
      '<p>Build-time snapshot: live savings estimate unavailable.</p>'
    )
    .replace(/<(script|style|svg|button)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(
      /(?:<pre\b[^>]*>|<div\b[^>]*class=["'][^"']*code-body[^"']*["'][^>]*>)([\s\S]*?)(?:<\/pre>|<\/div>)/gi,
      (_, code) => {
        const index =
          blocks.push(`\n\n\`\`\`\n${decode(code.replace(/<[^>]+>/g, '')).trim()}\n\`\`\`\n\n`) - 1;
        return `\nSOURCE_CODE_${index}\n`;
      }
    )
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level, value) => `\n\n${'#'.repeat(Number(level))} ${value}\n\n`
    )
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, value) => `[${value.replace(/<[^>]*>/g, '').trim()}](${href})`
    )
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:p|div|section|article|ul|ol|header)\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) =>
      decode(line)
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.replace(/SOURCE_CODE_(\d+)/g, (_, index) => blocks[Number(index)]).trim();
}
function decode(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
