import { isWorkersAiEnabled } from './config';
import { estimateNeuronCost, tryDebitNeurons } from './state/neuron-budget';
import type { Env } from './types';

const MAX_REQUEST_BYTES = 524_288;
const PROJECTS = new Set([
  'meme-lab',
  'knowledge-base',
  'starboard',
  'open-historia',
  'karte',
  'mentionpilot',
  'reader',
  'rolepatch',
  'live',
  'high-signal',
]);
const NATIVE_MODELS = new Set([
  '@cf/baai/bge-base-en-v1.5',
  '@cf/baai/bge-small-en-v1.5',
  '@cf/baai/bge-large-en-v1.5',
  '@cf/baai/bge-reranker-base',
]);

export function isFleetProject(project: unknown): project is string {
  return typeof project === 'string' && PROJECTS.has(project);
}

function unavailable(code: string, message: string): Response {
  return Response.json({ error: { code, message, type: 'configuration_error' } }, { status: 503 });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('Request body exceeds the Fleet gateway limit');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid JSON body');
  return body as Record<string, unknown>;
}

/** Called only by the named, private service entrypoint; never by public HTTP. */
export async function fetchFleetRequest(
  request: Request,
  env: Env,
  dispatch: (request: Request) => Promise<Response>
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/embeddings'].includes(path)) {
    return Response.json({ error: { message: 'Unsupported Fleet operation' } }, { status: 404 });
  }
  const project = request.headers.get('x-gateway-project-id');
  if (!isFleetProject(project)) {
    return Response.json({ error: { message: 'Unknown Fleet project' } }, { status: 400 });
  }
  if (!env.GATEWAY_API_KEY)
    return unavailable('auth_not_configured', 'Gateway access is unavailable');
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return Response.json(
      { error: { message: 'Invalid or oversized request body' } },
      { status: 400 }
    );
  }
  if (body.project_id !== undefined && body.project_id !== project) {
    return Response.json(
      { error: { message: 'Project attribution does not match' } },
      { status: 400 }
    );
  }
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${env.GATEWAY_API_KEY}`);
  headers.delete('x-api-key');
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  // Preserve a forwarded visitor address; isolate addressless server jobs by project.
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `fleet:${project}`);
  return dispatch(
    new Request(`https://fleet-gateway.internal${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, project_id: project }),
      signal: request.signal,
    })
  );
}

function nativeError(code: string): Error {
  return Object.assign(new Error(`Free AI native inference unavailable: ${code}`), { code });
}

function embeddingInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw nativeError('invalid_input');
  const input = value as Record<string, unknown>;
  const texts = typeof input.text === 'string' ? [input.text] : input.text;
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > 100 ||
    texts.some((text) => typeof text !== 'string' || text.length === 0)
  ) {
    throw nativeError('invalid_input');
  }
  if (
    Object.keys(input).some((key) => key !== 'text' && key !== 'pooling') ||
    (input.pooling !== undefined && input.pooling !== 'cls')
  )
    throw nativeError('invalid_input');
  return input;
}

function nativeCost(model: string, input: Record<string, unknown>): number {
  const inputBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (inputBytes > MAX_REQUEST_BYTES) throw nativeError('invalid_input');
  const cost = estimateNeuronCost(model, { inputBytes: inputBytes + 32 });
  if (cost === null) throw nativeError('neuron_budget_model_unpriced');
  return cost;
}

/** Preserve the exact embedding coordinate space, including explicit CLS pooling. */
export async function runFleetNative(
  env: Env,
  project: string,
  model: string,
  value: unknown
): Promise<unknown> {
  if (!isFleetProject(project)) throw nativeError('invalid_project_id');
  if (!NATIVE_MODELS.has(model)) throw nativeError('neuron_budget_model_unpriced');
  // Unpriced native rerankers must deny before inspecting any provider payload.
  if (estimateNeuronCost(model) === null) throw nativeError('neuron_budget_model_unpriced');
  const input = embeddingInput(value);
  const cost = nativeCost(model, input);
  if (!isWorkersAiEnabled(env) || !env.AI) throw nativeError('workers_ai_unavailable');
  const debit = await tryDebitNeurons(env, cost);
  if (!debit.allowed)
    throw nativeError(debit.dayKey ? 'neuron_budget_exhausted' : 'neuron_budget_unavailable');
  return env.AI.run(model, input);
}
