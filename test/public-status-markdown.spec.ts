import { describe, it, expect } from 'vitest';
import { renderStatusMarkdown } from '../src/public-status-markdown';
import { publicProof } from '../site/src/lib/public-proof';

describe('public Markdown data', () => {
  it('uses the same public sources, distinguishes missing telemetry, and renders model state', async () => {
    const calls: string[] = [];
    const markdown = await renderStatusMarkdown(async (path) => {
      calls.push(path);
      return path === '/v1/models'
        ? {
            data: [
              {
                id: 'test/model',
                model: 'model',
                provider: 'test',
                type: 'chat',
                enabled: false,
                tool_calling: true,
                success_rate: 0.5,
              },
            ],
          }
        : { stats: null };
    });
    expect(calls.sort()).toEqual(['/v1/models', '/v1/stats/providers']);
    expect(markdown).toContain('Provider stats unavailable');
    expect(markdown).toContain('| test/model | test | chat | tools | 50.0% | disabled |');
    expect(markdown).toContain('overall success: —');
    expect(markdown).toContain('Observed:');
  });
  it('rejects missing model data instead of inventing a healthy empty registry', async () => {
    await expect(renderStatusMarkdown(async () => ({}))).rejects.toThrow(
      'Public models unavailable'
    );
  });
  it('shares the homepage estimate and preserves unavailable counters', () => {
    expect(publicProof(null)).toBeNull();
    expect(publicProof({ stats: [] })).toBeNull();
    expect(publicProof({ stats: [{ total_attempts: 1000 }] })).toEqual({
      requests: '1,000',
      savings: '30¢ saved',
    });
  });
});
