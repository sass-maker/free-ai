import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { DASHBOARD_HTML } from '../src/dashboard-html';

describe('dashboard PostHog bootstrap', () => {
  it('initializes the SDK queue with the dashboard key and capture settings', () => {
    const inserted: Array<Record<string, unknown>> = [];
    const firstScript = {
      parentNode: {
        insertBefore: (script: Record<string, unknown>) => inserted.push(script),
      },
    };
    const document = {
      createElement: () => ({}) as Record<string, unknown>,
      getElementsByTagName: () => [firstScript],
    };
    const window = { document } as Record<string, unknown>;
    window.window = window;

    const bootstrap = /<script>(.*?)<\/script>/s.exec(DASHBOARD_HTML)?.[1];
    expect(bootstrap).toBeTruthy();
    expect(() => vm.runInNewContext(bootstrap!, { window, document })).not.toThrow();

    const posthog = window.posthog as {
      __SV: number;
      __loaded?: boolean;
      _i: Array<[string, Record<string, unknown>, string]>;
      capture: (...args: unknown[]) => void;
      [key: number]: unknown;
    };
    expect(posthog.__SV).toBe(1);
    expect(posthog.__loaded).toBeUndefined();
    expect(posthog._i).toHaveLength(1);
    expect(posthog._i[0]).toHaveLength(3);
    expect(posthog._i[0]?.[2]).toBe('posthog');
    expect(inserted).toHaveLength(1);
    expect(posthog._i[0]?.[0]).toBe('phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd');
    expect(posthog._i[0]?.[1]).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'always',
      capture_pageview: false,
      autocapture: false,
    });
    expect(inserted[0]).toMatchObject({
      src: 'https://us-assets.i.posthog.com/static/array.js',
      async: true,
      crossOrigin: 'anonymous',
    });

    const init = posthog._i[0];
    const config = init?.[1] as
      | { loaded?: (sdk: { capture: (...args: unknown[]) => void }) => void }
      | undefined;
    const captured: unknown[][] = [];
    const sdk = { capture: (...args: unknown[]) => captured.push(args) };
    window.posthog = sdk;
    config?.loaded?.(sdk);
    expect(captured).toEqual([['page_view', { project_id: 'free-ai' }]]);
    expect(posthog).toHaveLength(0);
  });
});
