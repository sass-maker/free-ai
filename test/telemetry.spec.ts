import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTelemetry() {
  vi.resetModules();
  return import('../src/lib/telemetry');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PostHog telemetry', () => {
  it('does not send or queue events before configuration', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { capture, flushPostHog } = await loadTelemetry();

    capture({ distinctId: 'anonymous', event: 'ignored' });
    await flushPostHog();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captures configured events and flushes the pending queue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { capture, configurePostHog, flushPostHog } = await loadTelemetry();

    configurePostHog('posthog-key', 'https://posthog.example///');
    capture({
      distinctId: 'user-1',
      event: 'request_completed',
      properties: { provider: 'groq' },
    });
    await flushPostHog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://posthog.example/i/v0/e/');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: 'posthog-key',
      distinct_id: 'user-1',
      event: 'request_completed',
      properties: { provider: 'groq' },
    });
  });

  it('uses the default host and empty properties', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { capture, configurePostHog, flushPostHog } = await loadTelemetry();

    configurePostHog('posthog-key');
    capture({ distinctId: 'user-2', event: 'request_started' });
    await flushPostHog();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(JSON.parse(String(init.body)).properties).toEqual({});
  });

  it.each([
    [new Error('network down'), 'network down'],
    ['network down', 'network down'],
  ])('logs rejected capture %p without rejecting flush', async (failure, message) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { capture, configurePostHog, flushPostHog } = await loadTelemetry();

    configurePostHog('posthog-key');
    capture({ distinctId: 'user-3', event: 'request_failed' });

    await expect(flushPostHog()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith('[telemetry] PostHog capture failed:', message);
  });
});

describe('trace', () => {
  it('returns successful results and logs elapsed time', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(112.345);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { trace } = await loadTelemetry();

    await expect(trace('model-select', async () => 'groq')).resolves.toBe('groq');
    expect(info).toHaveBeenCalledWith('[trace] model-select completed in 12.34ms');
  });

  it('supports silent successful traces', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { trace } = await loadTelemetry();

    await expect(trace('quiet', async () => 42, { silent: true })).resolves.toBe(42);
    expect(info).not.toHaveBeenCalled();
  });

  it('rethrows failures after logging elapsed time', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(50).mockReturnValueOnce(55.678);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { trace } = await loadTelemetry();
    const failure = new Error('provider failed');

    await expect(
      trace('provider-call', async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(errorLog).toHaveBeenCalledWith('[trace] provider-call failed after 5.68ms');
  });

  it('supports silent failed traces', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { trace } = await loadTelemetry();

    await expect(
      trace(
        'quiet-failure',
        async () => {
          throw new Error('failed');
        },
        { silent: true }
      )
    ).rejects.toThrow('failed');
    expect(errorLog).not.toHaveBeenCalled();
  });
});
