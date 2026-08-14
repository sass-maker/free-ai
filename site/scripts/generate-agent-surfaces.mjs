import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_SURFACE } from '../../src/agent-edge.mjs';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ROOT = join(SITE_ROOT, 'dist');
const DOCS_ROOT = join(SITE_ROOT, 'src/content/docs');

const surfaces = AGENT_SURFACE.catalog.surfaces;
const sitemapSurfaces = surfaces.filter((surface) => surface.sitemap !== false);

await Promise.all(surfaces.map(writeMarkdownSurface));
await writeFile(join(DIST_ROOT, 'sitemap.xml'), renderSitemap(), 'utf8');
await writeFile(
  join(DIST_ROOT, 'api-ai.json'),
  `${JSON.stringify(AGENT_SURFACE.catalog, null, 2)}\n`,
  'utf8'
);
await validateGeneratedSurfaces();

console.log(`Generated ${surfaces.length} agent-readable public surfaces.`);

async function writeMarkdownSurface(surface) {
  const routePath = new URL(surface.url).pathname;
  const markdownPath = new URL(surface.md).pathname;
  const outputPath = join(DIST_ROOT, markdownPath);
  const slug = routePath === '/' ? 'index' : routePath.slice(1);
  const docsSource = join(DOCS_ROOT, `${slug}.mdx`);

  let markdown;
  if (surface.kind === 'docs') {
    markdown = await markdownFromMdx(docsSource);
  } else {
    const htmlPath =
      routePath === '/' ? join(DIST_ROOT, 'index.html') : join(DIST_ROOT, routePath, 'index.html');
    markdown = markdownFromHtml(await readFile(htmlPath, 'utf8'));
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${markdown.trim()}\n`, 'utf8');
}

async function markdownFromMdx(path) {
  const source = await readFile(path, 'utf8');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter in ${path}`);

  const title = frontmatterValue(match[1], 'title');
  const description = frontmatterValue(match[1], 'description');
  const body = match[2]
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/<Tabs>/g, '')
    .replace(/<\/Tabs>/g, '')
    .replace(/<TabItem\s+label=(?:"([^"]+)"|'([^']+)')>/g, (_, a, b) => `\n### ${a || b}\n`)
    .replace(/<\/TabItem>/g, '')
    .trim();

  return [`# ${title}`, description ? `> ${description}` : '', body].filter(Boolean).join('\n\n');
}

function markdownFromHtml(html) {
  const title = decodeHtml(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const primaryHeading = stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) || title;
  const description = decodeHtml(
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i)
  );
  const body = firstMatch(html, /<body[^>]*>([\s\S]*?)<\/body>/i) || html;
  const readable = body
    .replace(/<(script|style|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, value) => {
      if (Number(level) === 1) return '';
      return `\n${'#'.repeat(Number(level))} ${stripTags(value)}\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, value) => `\n- ${stripTags(value)}`)
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, value) => {
      const label = stripTags(value);
      return label ? `[${label}](${href})` : '';
    })
    .replace(/<(p|div|section|article|header|aside|tr|ul|ol|table|thead|tbody)[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|aside|tr|ul|ol|table|thead|tbody)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, value) => `\`${stripTags(value)}\``)
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) =>
      decodeHtml(line)
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');

  return [`# ${primaryHeading}`, description ? `> ${description}` : '', readable]
    .filter(Boolean)
    .join('\n\n');
}

function renderSitemap() {
  const urls = sitemapSurfaces
    .map((surface) => `  <url><loc>${escapeXml(canonicalHtmlUrl(surface.url))}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function validateGeneratedSurfaces() {
  const ids = new Set();
  const urls = new Set();
  for (const surface of surfaces) {
    const routePath = new URL(surface.url).pathname;
    if (ids.has(surface.id)) throw new Error(`Duplicate surface id: ${surface.id}`);
    if (urls.has(surface.url)) throw new Error(`Duplicate surface URL: ${surface.url}`);
    ids.add(surface.id);
    urls.add(surface.url);

    if (!surface.url.startsWith(AGENT_SURFACE.url)) {
      throw new Error(`Foreign surface URL: ${surface.url}`);
    }
    if (!surface.md.startsWith(AGENT_SURFACE.url)) {
      throw new Error(`Foreign Markdown URL: ${surface.md}`);
    }
    if (new URL(surface.url).pathname.startsWith('/api/')) {
      throw new Error(`API route cannot be an HTML sitemap surface: ${surface.url}`);
    }

    const markdown = await readFile(join(DIST_ROOT, new URL(surface.md).pathname), 'utf8');
    if (!markdown.trimStart().startsWith('#')) {
      throw new Error(`Markdown does not start with a heading: ${surface.md}`);
    }
    if (/<!doctype\s+html|<html\b/i.test(markdown)) {
      throw new Error(`Markdown contains an HTML shell: ${surface.md}`);
    }

    if (surface.sitemap !== false) {
      const htmlPath =
        routePath === '/'
          ? join(DIST_ROOT, 'index.html')
          : join(DIST_ROOT, routePath, 'index.html');
      const html = await readFile(htmlPath, 'utf8');
      const canonical =
        firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
        firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
      const expectedCanonical = canonicalHtmlUrl(surface.url);
      if (canonical !== expectedCanonical) {
        throw new Error(
          `Canonical mismatch for ${surface.id}: expected ${expectedCanonical}, found ${canonical || 'missing'}`
        );
      }
    }
  }
}

function canonicalHtmlUrl(value) {
  const url = new URL(value);
  if (url.pathname !== '/') url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  return url.href;
}

function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return '';
  const value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function firstMatch(value, pattern) {
  return value.match(pattern)?.[1]?.trim() || '';
}

function stripTags(value) {
  return decodeHtml(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
