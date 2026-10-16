import { z } from '@hono/zod-openapi';

import { parseApiKeys } from '../providers/api-key';
import type { GatewayApp } from './shared-schemas';

const MAX_CATALOG_BYTES = 512 * 1024;
const catalogSchema = z.object({
  data: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[a-zA-Z0-9._:/@-]+$/),
      })
    )
    .min(1)
    .max(5000),
});

async function readCatalog(response: Response): Promise<Array<{ id: string }>> {
  if (!response.body) throw new Error('Empty catalog');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) {
        await reader.cancel();
        throw new Error('Catalog exceeds limit');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const catalog = catalogSchema.parse(JSON.parse(text));
  return [...new Set(catalog.data.map((model) => model.id))].map((id) => ({ id }));
}

export function registerProviderCatalogRoutes(app: GatewayApp): void {
  // Keep credentials in the Worker. This fixed, read-only endpoint remains
  // behind the normal gateway authentication and IP rate limit.
  app.get('/v1/provider-catalogs/mistral', async (context) => {
    context.header('cache-control', 'private, no-store');
    const key = parseApiKeys(context.env.MISTRAL_API_KEY)[0];
    if (!key) {
      return context.json({ error: { code: 'provider_not_configured' } }, 503);
    }

    try {
      const response = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        // Workers forward sensitive headers across redirects by default.
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return context.json(
          { error: { code: 'catalog_upstream_error', upstream_status: response.status } },
          502
        );
      }

      const data = await readCatalog(response);
      return context.json({ data });
    } catch {
      // Never forward provider bodies, exception messages or credentials.
      return context.json({ error: { code: 'catalog_unavailable' } }, 502);
    }
  });
}
