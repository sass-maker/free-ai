import test from 'node:test';
import assert from 'node:assert/strict';
import {
  labelsValid,
  toolValid,
  narrativeValid,
  streamValid,
  quotaHeaders,
  request,
  gatewayFixtures,
  DIRECT_FIXTURES,
  runQualification,
} from './qualify-inference-capacity.mjs';
const completion = (value) => ({
  choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
});
const valid = completion(['billing', 'bug', 'feature']);
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const stream =
  event({ choices: [{ delta: { content: 'capacity-stream-ok' }, finish_reason: null }] }) +
  event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
  'data: [DONE]\n\n';

test('useful labels reject HTTP-only, reasoning-only, malformed and incorrect output', () => {
  assert.equal(labelsValid(valid), true);
  for (const body of [
    { ok: true },
    { choices: [{ message: { reasoning_content: 'private' } }] },
    completion(['feature', 'bug', 'billing']),
    { choices: [{ message: { content: '[' } }] },
  ])
    assert.equal(labelsValid(body), false);
});
test('tool call validates the actual arguments and name', () => {
  const call = {
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                name: 'record_labels',
                arguments: '{"labels":["billing","bug","feature"]}',
              },
            },
          ],
        },
      },
    ],
  };
  assert.equal(toolValid(call), true);
  call.choices[0].message.tool_calls[0].function.arguments = '{}';
  assert.equal(toolValid(call), false);
});
test('longer narrative preserves state and requires substantial output', () => {
  const row = {
    year: 1453,
    treasury: 100,
    narrative: 'a'.repeat(400),
    choices: ['First useful choice', 'Second useful choice', 'Third useful choice'],
  };
  assert.equal(narrativeValid(completion(row)), true);
  assert.equal(narrativeValid(completion({ ...row, year: 1454 })), false);
  assert.equal(narrativeValid(completion({ ...row, narrative: 'short' })), false);
});
test('stream requires usable content, terminal reason, DONE and valid frames', () => {
  assert.equal(streamValid(stream), true);
  for (const text of [
    stream.replace('data: [DONE]', ''),
    stream.replace('"stop"', 'null'),
    stream.replace('capacity-stream-ok', 'wrong'),
    stream + event({ error: 'private' }),
    'data: invalid\n\ndata: [DONE]',
  ])
    assert.equal(streamValid(text), false);
});
test('quota headers allow only bounded numeric or duration fields', () => {
  const headers = new Headers({
    'x-ratelimit-limit-requests': '1000',
    'x-ratelimit-reset-tokens': '1m2.3s',
    Authorization: 'private-secret',
    'x-ratelimit-remaining-tokens': 'private-secret',
  });
  assert.deepEqual(quotaHeaders(headers), {
    'x-ratelimit-limit-requests': '1000',
    'x-ratelimit-reset-tokens': '1m2.3s',
  });
});
test('deadline includes stalled post-header body and reports no response text', async () => {
  const result = await request(
    'gateway',
    '/v1/chat/completions',
    'private-secret',
    { model: 'auto' },
    labelsValid,
    {
      timeoutMs: 10,
      fetchImpl: async () => new Response(new ReadableStream({ start() {}, cancel() {} })),
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.ok(result.totalMs < 1000);
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
});
test('errors, response model values and headers cannot be emitted as raw output', async () => {
  const result = await request(
    'gateway',
    '/v1/chat/completions',
    'private-secret',
    { model: 'auto' },
    labelsValid,
    {
      fetchImpl: async () =>
        new Response(JSON.stringify({ ...valid, model: 'private-secret' }), {
          headers: { 'x-gateway-provider': 'private-secret', 'x-gateway-model': 'private-secret' },
        }),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
  const failed = await request(
    'gateway',
    '/v1/chat/completions',
    'private-secret',
    { model: 'auto' },
    labelsValid,
    {
      fetchImpl: async () => {
        throw new Error('private-secret');
      },
    }
  );
  assert.equal(JSON.stringify(failed).includes('private-secret'), false);
});
test('non-200 and malformed response cannot pass a useful-output check', async () => {
  for (const response of [
    new Response(JSON.stringify(valid), { status: 502 }),
    new Response('not-json'),
  ]) {
    const result = await request(
      'gateway',
      '/v1/chat/completions',
      'key',
      { model: 'auto' },
      labelsValid,
      { fetchImpl: async () => response }
    );
    assert.equal(result.ok, false);
  }
});
test('destinations, workload tokens and counts stay bounded', async () => {
  await assert.rejects(
    request('unknown', '/v1/chat/completions', 'key', {}, labelsValid),
    /Untrusted/
  );
  await assert.rejects(request('gateway', '//evil.example', 'key', {}, labelsValid), /Untrusted/);
  const fixtures = gatewayFixtures();
  assert.equal(fixtures.length, 15);
  assert.equal(DIRECT_FIXTURES.length, 7);
  assert.equal(fixtures.filter((f) => f.payload.max_tokens > 256).length, 1);
  assert.equal(Math.max(...fixtures.map((f) => f.payload.max_tokens)), 2048);
  assert.ok(DIRECT_FIXTURES.every((f) => f.tokens <= 128 && f.provider !== 'mistral'));
});
test('runner concurrency is at most three and missing direct connections stay unverified', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const report = await runQualification(
    { GATEWAY_API_KEY: 'key' },
    {
      fetchImpl: async (url, init) => {
        assert.ok(url.startsWith('https://ai-gateway.sassmaker.com/v1/'));
        assert.equal(init.redirect, 'error');
        active++;
        calls++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return Response.json(valid);
      },
    }
  );
  assert.equal(calls, 15);
  assert.equal(peak, 3);
  assert.equal(report.ok, false);
  assert.equal(report.direct.length, 7);
  assert.ok(report.direct.every((row) => row.state === 'connection_unavailable'));
  assert.equal(JSON.stringify(report).includes('GATEWAY_API_KEY'), false);
});

test('nonstream and replay provider attribution uses allowlisted body metadata', async () => {
  for (const body of [
    { ...valid, x_gateway: { provider: 'gemini' } },
    { ok: true, provider: 'gemini', completion: valid },
  ]) {
    const result = await request(
      'gateway',
      '/v1/chat/completions',
      'key',
      { model: 'auto' },
      labelsValid,
      { fetchImpl: async () => Response.json(body) }
    );
    assert.equal(result.provider, 'gemini');
  }
});
test('malformed long quota headers stay bounded', () => {
  const headers = new Headers({ 'x-ratelimit-limit-requests': `${'1'.repeat(200)}!` });
  assert.deepEqual(quotaHeaders(headers), {});
});
