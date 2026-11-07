#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const ORIGINS = Object.freeze({
  gateway: 'https://ai-gateway.sassmaker.com',
  nvidia: 'https://integrate.api.nvidia.com',
  cohere: 'https://api.cohere.ai',
  groq: 'https://api.groq.com',
});
const LABELS = ['billing', 'bug', 'feature'];
const PROMPT =
  'Classify each support message in order. Return only a JSON array of labels billing, bug, or feature. Messages: 1. I was charged twice. 2. Clicking Save crashes the app. 3. Please add a dark theme.';
const FINISH = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']);
const PROVIDERS = new Set([
  'workers_ai',
  'groq',
  'gemini',
  'openrouter',
  'nvidia',
  'pollinations',
  'cohere',
  'mistral',
  'zai',
  'cerebras',
  'sambanova',
  'github_models',
  'modelscope',
  'siliconflow',
  'together',
]);
const integer = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const content = (body) => body?.choices?.[0]?.message?.content;
export function labelsValid(body) {
  try {
    return JSON.stringify(JSON.parse(content(body))) === JSON.stringify(LABELS);
  } catch {
    return false;
  }
}
export function toolValid(body) {
  const calls = body?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== 'record_labels')
    return false;
  try {
    return (
      JSON.stringify(JSON.parse(calls[0].function.arguments)) === JSON.stringify({ labels: LABELS })
    );
  } catch {
    return false;
  }
}
export function narrativeValid(body) {
  try {
    const row = JSON.parse(content(body));
    return (
      row.year === 1453 &&
      row.treasury === 100 &&
      typeof row.narrative === 'string' &&
      row.narrative.length >= 400 &&
      Array.isArray(row.choices) &&
      row.choices.length === 3 &&
      row.choices.every((v) => typeof v === 'string' && v.length >= 12)
    );
  } catch {
    return false;
  }
}
export function streamValid(text) {
  let answer = '';
  let done = false;
  let finished = false;
  try {
    for (const line of text.replaceAll('\r', '').split('\n')) {
      if (!line.startsWith('data:')) continue;
      const value = line.slice(5).trim();
      if (value === '[DONE]') {
        done = true;
        continue;
      }
      if (done) return false;
      const row = JSON.parse(value);
      if (row.error) return false;
      for (const choice of row.choices ?? []) {
        if (typeof choice.delta?.content === 'string') answer += choice.delta.content;
        if (choice.finish_reason === 'stop') finished = true;
      }
    }
    return done && finished && answer.trim() === 'capacity-stream-ok';
  } catch {
    return false;
  }
}
export function quotaHeaders(headers) {
  const result = {};
  for (const suffix of [
    'limit-requests',
    'remaining-requests',
    'reset-requests',
    'limit-tokens',
    'remaining-tokens',
    'reset-tokens',
  ]) {
    const key = `x-ratelimit-${suffix}`;
    const value = headers.get(key);
    if (typeof value === 'string' && /^[0-9.a-z]{1,80}$/.test(value)) result[key] = value;
  }
  return result;
}
async function boundedText(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1048576) throw new Error('response_bound');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
function summarized(response, text, surface, payload, validate) {
  const body = payload.stream ? null : JSON.parse(text);
  const completion = body?.completion ?? body;
  const finish = completion?.choices?.[0]?.finish_reason;
  const candidates = [
    response.headers.get('x-gateway-provider'),
    completion?.x_gateway?.provider,
    body?.provider,
  ];
  return {
    ok: response.status === 200 && (payload.stream ? streamValid(text) : validate(completion)),
    provider: candidates.find((value) => PROVIDERS.has(value)) ?? surface,
    model: payload.model,
    finishReason: FINISH.has(finish) ? finish : null,
    outputChars: typeof content(completion) === 'string' ? content(completion).length : 0,
    usage: {
      promptTokens: integer(completion?.usage?.prompt_tokens),
      completionTokens: integer(completion?.usage?.completion_tokens),
    },
  };
}
export async function request(surface, path, key, payload, validate, options = {}) {
  if (
    !Object.hasOwn(ORIGINS, surface) ||
    (!path.startsWith('/v1/') &&
      !path.startsWith('/compatibility/v1/') &&
      !path.startsWith('/openai/v1/'))
  )
    throw new Error('Untrusted diagnostic destination');
  const started = Date.now();
  let headerMs = null;
  let status = null;
  let headers = {};
  const controller = new AbortController();
  let timer;
  const timeoutMs = options.timeoutMs ?? (surface === 'gateway' ? 45000 : 25000);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('deadline'));
      controller.abort();
    }, timeoutMs);
  });
  const perform = async () => {
    const response = await (options.fetchImpl ?? fetch)(ORIGINS[surface] + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
    });
    status = response.status;
    headerMs = Date.now() - started;
    if (surface === 'groq') headers = quotaHeaders(response.headers);
    return summarized(response, await boundedText(response), surface, payload, validate);
  };
  try {
    return {
      ...(await Promise.race([deadline, perform()])),
      status,
      headerMs,
      totalMs: Date.now() - started,
      quotaHeaders: headers,
    };
  } catch {
    controller.abort();
    return {
      ok: false,
      status,
      headerMs,
      totalMs: Date.now() - started,
      error: 'request_or_output_failed',
      quotaHeaders: headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

const schema = (name, properties, required) => ({
  type: 'json_schema',
  json_schema: {
    name,
    strict: true,
    schema: { type: 'object', properties, required, additionalProperties: false },
  },
});
const labelProperty = { type: 'array', items: { type: 'string', enum: LABELS } };
export function gatewayFixtures() {
  const base = {
    model: 'auto',
    project_id: 'free-ai',
    stream: false,
    max_tokens: 256,
    reasoning_effort: 'low',
    messages: [{ role: 'user', content: PROMPT }],
  };
  const fixtures = [];
  for (const effort of ['low', 'medium', 'high']) {
    for (let i = 0; i < 3; i++)
      fixtures.push({
        name: `burst-${effort}-${i + 1}`,
        payload: { ...base, reasoning_effort: effort },
        validate: labelsValid,
      });
  }
  for (const provider of ['groq', 'gemini'])
    fixtures.push({
      name: `fallback-${provider}`,
      replay: true,
      payload: { ...base, provider, include_completion: true },
      validate: labelsValid,
    });
  fixtures.push({
    name: 'strict-json',
    payload: {
      ...base,
      messages: [
        { role: 'user', content: `${PROMPT} Wrap the array in an object with the labels field.` },
      ],
      response_format: schema('labels', { labels: labelProperty }, ['labels']),
    },
    validate: (body) => {
      try {
        const row = JSON.parse(content(body));
        return (
          Object.keys(row).length === 1 && JSON.stringify(row.labels) === JSON.stringify(LABELS)
        );
      } catch {
        return false;
      }
    },
  });
  fixtures.push({
    name: 'tool-call',
    payload: {
      ...base,
      tools: [
        {
          type: 'function',
          function: {
            name: 'record_labels',
            description: 'Record the three support labels',
            parameters: {
              type: 'object',
              properties: { labels: labelProperty },
              required: ['labels'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'record_labels' } },
    },
    validate: toolValid,
  });
  fixtures.push({
    name: 'completed-stream',
    payload: {
      ...base,
      stream: true,
      messages: [
        { role: 'user', content: 'Reply with exactly capacity-stream-ok and nothing else.' },
      ],
    },
    validate: streamValid,
  });
  fixtures.push({
    name: 'representative-narrative',
    payload: {
      ...base,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content:
            'Write a synthetic historical strategy turn for year 1453 with treasury 100. Preserve year and treasury unchanged. Write a narrative of 150 to 220 words about three competing policy proposals and exactly three distinct actionable choices of at least twelve characters each. Return JSON with narrative, year, treasury and choices.',
        },
      ],
      response_format: schema(
        'turn',
        {
          narrative: { type: 'string' },
          year: { type: 'integer' },
          treasury: { type: 'integer' },
          choices: { type: 'array', items: { type: 'string' } },
        },
        ['narrative', 'year', 'treasury', 'choices']
      ),
    },
    validate: narrativeValid,
  });
  return fixtures;
}
export const DIRECT_FIXTURES = Object.freeze([
  { name: 'nvidia-20b-original', provider: 'nvidia', model: 'openai/gpt-oss-20b', tokens: 8 },
  {
    name: 'nvidia-20b-low',
    provider: 'nvidia',
    model: 'openai/gpt-oss-20b',
    tokens: 128,
    effort: 'low',
  },
  {
    name: 'nvidia-ultra-control',
    provider: 'nvidia',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    tokens: 128,
  },
  { name: 'cohere-a-original', provider: 'cohere', model: 'command-a-03-2025', tokens: 8 },
  { name: 'cohere-a-128', provider: 'cohere', model: 'command-a-03-2025', tokens: 128 },
  { name: 'cohere-r7b-control', provider: 'cohere', model: 'command-r7b-12-2024', tokens: 128 },
  {
    name: 'groq-quota-control',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    tokens: 128,
    effort: 'low',
  },
]);
export async function runQualification(env = process.env, options = {}) {
  if (!env.GATEWAY_API_KEY) return { ok: false, state: 'gateway_connection_unavailable' };
  const gateway = [];
  const fixtures = gatewayFixtures();
  const burstStarted = Date.now();
  for (let index = 0; index < 9; index += 3) {
    gateway.push(
      ...(await Promise.all(
        fixtures.slice(index, index + 3).map(async (f) => ({
          name: f.name,
          ...(await request(
            'gateway',
            '/v1/chat/completions',
            env.GATEWAY_API_KEY,
            f.payload,
            f.validate,
            options
          )),
        }))
      ))
    );
  }
  const burstMs = Date.now() - burstStarted;
  for (const f of fixtures.slice(9))
    gateway.push({
      name: f.name,
      ...(await request(
        'gateway',
        f.replay ? '/v1/debug/replay' : '/v1/chat/completions',
        env.GATEWAY_API_KEY,
        f.payload,
        f.validate,
        options
      )),
    });
  const direct = [];
  for (const f of DIRECT_FIXTURES) {
    const key = env[`${f.provider.toUpperCase()}_API_KEY`];
    if (!key) {
      direct.push({ name: f.name, ok: false, state: 'connection_unavailable' });
      continue;
    }
    const path =
      f.provider === 'groq'
        ? '/openai/v1/chat/completions'
        : f.provider === 'cohere'
          ? '/compatibility/v1/chat/completions'
          : '/v1/chat/completions';
    direct.push({
      name: f.name,
      ...(await request(
        f.provider,
        path,
        key,
        {
          model: f.model,
          max_tokens: f.tokens,
          stream: false,
          ...(f.effort && { reasoning_effort: f.effort }),
          messages: [{ role: 'user', content: 'Reply exactly capacity-ok and nothing else.' }],
        },
        (body) => content(body)?.trim() === 'capacity-ok',
        options
      )),
    });
  }
  return {
    ok: gateway.every((row) => row.ok),
    observedAt: new Date().toISOString(),
    bounds: {
      gatewayRequests: fixtures.length,
      directRequests: DIRECT_FIXTURES.length,
      burstConcurrency: 3,
      normalMaxOutputTokens: 256,
      narrativeMaxOutputTokens: 2048,
      directMaxOutputTokens: 128,
    },
    burst: {
      requests: 9,
      successful: gateway.slice(0, 9).filter((row) => row.ok).length,
      elapsedMs: burstMs,
    },
    gateway,
    direct,
    limitations: [
      'Small bounded qualification, not sustained throughput or guaranteed daily capacity.',
      'Provider/model quotas are shared; no model-count multiplication.',
      'Direct CI and Worker credentials may differ; account identity is not proven.',
      'Mistral free billing status is unverified; no direct or forced Mistral requests.',
      'Automatic routing retains existing policy; reported providers may include Mistral or budgeted Workers AI.',
      'QA traffic is attributed to free-ai; no private user prompts or completions are recorded.',
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runQualification();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
