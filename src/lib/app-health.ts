import { createAppHealthClient, type AppHealthClient } from '@saas-maker/app-health';
import type { Env } from '../types';

let client: AppHealthClient | null = null;

/**
 * Resolve the optional App Health client for this Worker isolate.
 *
 * The ingest key is runtime configuration only. A deployment without the
 * binding stays fully functional and emits no App Health traffic.
 */
export function getAppHealthClient(
  env: Pick<Env, 'APP_HEALTH_INGEST_KEY'>
): AppHealthClient | null {
  if (!env.APP_HEALTH_INGEST_KEY) return null;
  if (client === null) {
    client = createAppHealthClient({
      key: env.APP_HEALTH_INGEST_KEY,
      endpoint: 'https://ingest.sassmaker.com/v1/ingest',
      release: 'free-ai',
      runtime: 'worker',
      disableTimer: true,
    });
  }
  return client;
}
