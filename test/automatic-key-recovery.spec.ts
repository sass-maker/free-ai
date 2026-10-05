import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import type { ModelCandidate } from '../src/types';
import { logUpstreamFailure } from '../src/router/gemini-key-recovery';
import { makeCtx, makeTestEnv } from './helpers/env';

const mocks = vi.hoisted(() => ({ registry: [] as ModelCandidate[] }));
vi.mock('../src/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getModelRegistry: () => mocks.registry,
}));

function candidate(model: string, provider: 'gemini' | 'groq'): ModelCandidate {
  return {
    id: model,
    model,
    provider,
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 1,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32000,
      maxOutputTokens: 4096,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('automatic Gemini key recovery', () => {
  it.each(['json_validate_failed', 'context_length_exceeded', 'private synthetic prompt'])(
    'logs only allowlisted upstream error codes: %s',
    (code) => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logUpstreamFailure(
        {
          provider: 'groq',
          model: 'groq-alternate',
          attempt: 2,
          key_slot: null,
          key_pool_size: null,
        },
        Object.assign(new Error('Private upstream body'), { status: 400, code }),
        false
      );
      const entry = JSON.parse(String(log.mock.calls[0][0]));
      expect(entry.upstream_error_code).toBe(code.startsWith('private') ? null : code);
      expect(JSON.stringify(entry)).not.toContain('Private upstream body');
      expect(JSON.stringify(entry)).not.toContain('private synthetic prompt');
    }
  );
  it.each([1, 2, 3, 4, 5].flatMap((slot) => [401, 402, 403].map((status) => ({ slot, status }))))(
    'recovers denied slot $slot after $status before an unusable Groq fallback',
    async ({ slot, status }) => {
      mocks.registry = [candidate('gemini-first', 'gemini'), candidate('groq-alternate', 'groq')];
      vi.spyOn(Math, 'random')
        .mockReturnValue(0)
        .mockReturnValueOnce((slot - 1) / 5);
      const failed = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const accepted = vi.spyOn(console, 'info').mockImplementation(() => {});
      const calls: Request[] = [];
      const results = Array.from({ length: 30 }, (_, index) => ({
        label_index: index % 5,
        scores: Array.from({ length: 5 }, (_, category) => (category === index % 5 ? 0.8 : 0.05)),
      }));
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const sent = new Request(input, init);
        calls.push(sent);
        if (new URL(sent.url).hostname === 'api.groq.com') {
          return Response.json(
            { error: { code: 'json_validate_failed', message: 'Synthetic rejected output' } },
            { status: 400 }
          );
        }
        if (sent.headers.get('authorization') === `Bearer synthetic-${slot}`) {
          return new Response(null, { status });
        }
        return Response.json({
          model: 'gemini-first',
          choices: [
            {
              message: { role: 'assistant', content: JSON.stringify({ results }) },
              finish_reason: 'stop',
            },
          ],
        });
      });
      const { env } = makeTestEnv({
        GEMINI_API_KEY: 'synthetic-1,synthetic-2,synthetic-3,synthetic-4,synthetic-5',
        GROQ_API_KEY: 'synthetic-groq',
      });
      const response = await app.fetch(
        new Request('https://gateway.test/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: 'Bearer test-gateway-key', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'auto',
            project_id: 'meme-lab',
            max_tokens: 2000,
            stream: false,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'user', content: 'Return 30 independently rated candidate results as JSON.' },
            ],
          }),
        }),
        env,
        makeCtx()
      );
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(2);
      expect(calls.map((sent) => new URL(sent.url).hostname)).toEqual([
        'generativelanguage.googleapis.com',
        'generativelanguage.googleapis.com',
      ]);
      expect(calls[0].headers.get('authorization')).not.toBe(calls[1].headers.get('authorization'));
      for (const sent of calls) {
        expect(await sent.json()).toMatchObject({
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        });
      }
      const body = (await response.json()) as {
        x_gateway: { attempts: number; provider: string; model: string };
        choices: Array<{ message: { content: string } }>;
      };
      expect(body.x_gateway).toMatchObject({
        attempts: 2,
        provider: 'gemini',
        model: 'gemini-first',
      });
      expect(JSON.parse(body.choices[0].message.content).results).toEqual(results);
      const logs = [...failed.mock.calls, ...accepted.mock.calls]
        .map(([entry]) => String(entry))
        .join('');
      expect(logs).toContain('"key_retry_pending":true');
      expect(logs).not.toContain('synthetic-');
      expect(logs).not.toContain('independently rated');
    }
  );
});
