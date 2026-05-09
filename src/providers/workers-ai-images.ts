import { isWorkersAiEnabled } from '../config';
import { estimateNeuronCost, tryDebitNeurons } from '../state/neuron-budget';
import type { Env } from '../types';

export interface WorkersAiImageInput {
  env: Env;
  model: string;
  prompt: string;
  size?: string;
  response_format?: 'url' | 'b64_json';
  n?: number;
}

export interface WorkersAiImageOutput {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function callWorkersAiImages(input: WorkersAiImageInput): Promise<WorkersAiImageOutput> {
  if (!isWorkersAiEnabled(input.env)) {
    throw new Error('Workers AI is disabled');
  }

  if (!input.env.AI || typeof input.env.AI.run !== 'function') {
    throw new Error('Workers AI binding not available');
  }

  const debit = await tryDebitNeurons(input.env, estimateNeuronCost(input.model));
  if (!debit.allowed) {
    throw new Error(`Daily Workers AI Neuron budget exhausted (${debit.used}/9500)`);
  }

  const { width, height } = parseSize(input.size);
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    width,
    height,
    num_steps: 4,
  };

  const result = (await input.env.AI.run(input.model, payload)) as unknown;

  let base64: string | undefined;

  if (result instanceof ReadableStream) {
    const response = new Response(result);
    const buf = await response.arrayBuffer();
    base64 = arrayBufferToBase64(buf);
  } else if (result instanceof ArrayBuffer) {
    base64 = arrayBufferToBase64(result);
  } else if (result instanceof Uint8Array) {
    base64 = arrayBufferToBase64(result.buffer as ArrayBuffer);
  } else if (result && typeof result === 'object') {
    const asObj = result as Record<string, unknown>;
    if (typeof asObj.image === 'string') {
      base64 = asObj.image;
    } else if (typeof asObj.b64_json === 'string') {
      base64 = asObj.b64_json;
    }
  }

  if (!base64) {
    throw new Error('Workers AI image returned no data');
  }

  if (input.response_format === 'b64_json') {
    return {
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: base64 }],
    };
  }

  // Return as data URL so clients can render it without a CDN.
  const url = `data:image/png;base64,${base64}`;
  return {
    created: Math.floor(Date.now() / 1000),
    data: [{ url, b64_json: base64 }],
  };
}
