import runtimePages from '../../src/public-runtime-pages.json' with { type: 'json' };
import { AGENT_SURFACE } from '../../src/agent-edge.mjs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentSurfaceManifest } from '../../src/lib/agent-surfaces/manifest.mjs';
import { createAgentSurfaceHandler } from '../../src/lib/agent-surfaces/handler.mjs';
import { absoluteMarkdownLinks } from '../../src/lib/agent-surfaces/format.mjs';
import { docsPages, docsIntro, docsOutro } from '../src/data/docs-index.mjs';
import { identity } from '../src/data/site-identity.mjs';
import { publicPageMeta } from '../src/data/public-content.mjs';
import { renderPublicPage } from './public-page-markdown.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const origin = publicPageMeta.origin;
const excluded = new Set(runtimePages.flatMap((page) => [page.path, ...page.htmlAliases]));

const attr = (tag, name) => tag?.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'))?.[2];
const decode = (text) =>
  text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
async function walk(dir) {
  return (
    await Promise.all(
      (
        await readdir(dir, { withFileTypes: true })
      ).map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name)))
    )
  ).flat();
}
export async function finalizeMarkdown() {
  const routes = [],
    pages = {};
  for (const file of (await walk(dist)).filter((f) => f.endsWith('.html'))) {
    let html = await readFile(file, 'utf8');
    const rel = relative(dist, file);
    if (/404\.html$/.test(rel)) continue;
    const tags = html.match(/<(?:meta|link)\b[^>]*>/gi) || [];
    if (tags.some((t) => attr(t, 'name') === 'robots' && /noindex/i.test(attr(t, 'content'))))
      continue;
    const canonical = attr(
      tags.find((t) => attr(t, 'rel') === 'canonical'),
      'href'
    );
    if (!canonical) throw new Error(`Public HTML missing canonical: ${rel}`);
    const url = new URL(canonical, origin);
    if (url.origin !== origin) throw new Error(`Unexpected canonical: ${canonical}`);
    const key = url.pathname.replace(/\/$/, '') || '/';
    // These static docs are shadowed by the worker's operator/API routes.
    if (excluded.has(key)) continue;
    const description = decode(
      attr(
        tags.find((t) => attr(t, 'name') === 'description'),
        'content'
      ) || ''
    );
    const slug = key === '/' ? 'index' : key.replace(/^\//, '');
    let markdown;
    if (publicPageMeta[slug]) markdown = await renderPublicPage(slug);
    else {
      const docsSlug = slug.replace(/^docs\//, '');
      if (slug === 'docs') {
        markdown = `# API documentation\n\n${docsIntro} [\`/docs/getting-started\`](${origin}/docs/getting-started/) ${docsOutro}\n\n${docsPages.map(([slug, title, description]) => `## [${title}](${origin}/docs/${slug}/)\n\n${description}`).join('\n\n')}\n\nOpenAI-compatible endpoints live under \`/v1\`.\n`;
      } else {
        const source = await readFile(join(root, 'src/content/docs', `${docsSlug}.mdx`), 'utf8');
        const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (!match) throw new Error(`Missing source frontmatter: ${slug}`);
        const title = match[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
        const body = match[2]
          .replace(/^import\s+.*?;\s*$/gm, '')
          .replace(/<\/?Tabs>/g, '')
          .replace(/<TabItem\s+label=["']([^"']+)["']>/g, '\n### $1\n')
          .replace(/<\/TabItem>/g, '');
        markdown = `# ${title}\n\n${body.trim()}\n`;
      }
    }
    const title = markdown.match(/^# (.+)$/m)?.[1];
    if (!title) throw new Error(`Missing source heading: ${slug}`);
    markdown = markdown
      .replace(/^# [^\n]+\n+/, '')
      .replace(/^> [^\n]+\n+/, '')
      .replace(/^Source: [^\n]+\n+/, '');
    markdown = absoluteMarkdownLinks(
      `# ${title}\n\n> ${description || title}\n\nCanonical: ${url.href}\n\n${markdown}`,
      url.href
    );
    const md = key === '/' ? '/index.md' : `${key}.md`;
    await mkdir(dirname(join(dist, md)), { recursive: true });
    await writeFile(join(dist, md), markdown);
    routes.push({
      path: url.pathname,
      url: url.href,
      md: origin + md,
      assetPath: md,
      title,
      description,
      kind: key === '/status' ? 'dynamic' : publicPageMeta[slug] ? 'static' : 'docs',
      ...(key === '/status' ? { full: false } : {}),
    });
    pages[url.pathname] = markdown;
    const alternate = `<link rel="alternate" type="text/markdown" href="${origin + md}">`;
    html = /<link\b[^>]*type=["']text\/markdown["'][^>]*>/i.test(html)
      ? html.replace(/<link\b[^>]*type=["']text\/markdown["'][^>]*>/gi, alternate)
      : html.replace('</head>', `${alternate}</head>`);
    if (!/<meta\b[^>]*name=["']ai-summary["']/i.test(html))
      html = html.replace(
        '</head>',
        `<meta name="ai-summary" content="${escape(description || title)}"></head>`
      );
    await writeFile(file, html);
  }
  for (const page of runtimePages)
    routes.push({
      path: page.path,
      url: origin + page.path,
      md: `${origin}${page.path}.md`,
      title: page.title,
      description: page.description,
      aliases: page.aliases,
      kind: 'dynamic',
      full: false,
    });
  routes.sort((a, b) => a.path.localeCompare(b.path));
  await mkdir(join(dist, 'api/md'), { recursive: true });
  await writeFile(join(dist, 'api/md/_catalog'), JSON.stringify(routes));
  await writeFile(join(dist, 'api/md/_identity'), JSON.stringify(identity));
  await writeFile(
    join(dist, 'api-ai.json'),
    JSON.stringify(
      {
        ...AGENT_SURFACE.catalog,
        surfaces: routes.map((route) => ({
          id: route.path === '/' ? 'home' : route.path.replace(/^\/|\/$/g, '').replaceAll('/', '-'),
          url: route.url,
          md: route.md,
          description: route.description,
          kind: route.kind,
        })),
      },
      null,
      2
    )
  );
  const manifest = createAgentSurfaceManifest({ ...identity, pages });
  const handler = createAgentSurfaceHandler({
    manifest,
    listMarkdownRoutes: () => routes,
    publicReservedPaths: ['/dashboard'],
  });
  for (const path of ['/llms.txt', '/llms-full.txt', '/ai.txt'])
    await writeFile(join(dist, path), await (await handler(new Request(origin + path))).text());
  await writeFile(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((r) => `<url><loc>${r.url}</loc></url>`).join('')}</urlset>`
  );
  console.log(
    `Public source registry: ${routes.length} Markdown routes; runtime public views registered; HTML/API aliases canonicalized.`
  );
}
await finalizeMarkdown();
