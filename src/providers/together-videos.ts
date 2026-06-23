import type { Env, VideoAspectRatio } from '../types';

export interface TogetherVideoInput {
  env: Env;
  model: string;
  prompt: string;
  duration_seconds?: number;
  aspect_ratio?: VideoAspectRatio;
  image_url?: string;
}

export interface TogetherVideoJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  video_url?: string;
  error?: string;
  created?: number;
}

// Together's video API uses async jobs. Submit returns an id that we poll.
// Endpoint shape is best-effort; adapts to common Together patterns.
export async function submitTogetherVideo(input: TogetherVideoInput): Promise<TogetherVideoJob> {
  if (!input.env.TOGETHER_API_KEY) {
    throw new Error('TOGETHER_API_KEY is not configured');
  }

  const payload: Record<string, unknown> = { prompt: input.prompt };
  if (input.duration_seconds) payload.duration = input.duration_seconds;
  if (input.aspect_ratio) payload.aspect_ratio = input.aspect_ratio;
  if (input.image_url) payload.image_url = input.image_url;

  const body = {
    model: input.model,
    payload,
  };

  const response = await fetch('https://api.together.xyz/v1/videos/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.env.TOGETHER_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Together video submit error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    id?: string;
    job_id?: string;
    requestId?: string;
    status?: string;
    video_url?: string;
    url?: string;
    data?: Array<{ url?: string; video_url?: string }>;
  };

  const id = json.requestId ?? json.id ?? json.job_id ?? `vid_${crypto.randomUUID()}`;
  const rawStatus = (json.status ?? 'processing').toLowerCase();
  const status: TogetherVideoJob['status'] =
    rawStatus.includes('complet') || rawStatus === 'succeeded' || rawStatus === 'done'
      ? 'completed'
      : rawStatus.includes('fail') || rawStatus === 'error'
        ? 'failed'
        : 'processing';

  const video_url = json.video_url ?? json.url ?? json.data?.[0]?.video_url ?? json.data?.[0]?.url;

  return {
    id,
    status,
    video_url,
    created: Math.floor(Date.now() / 1000),
  };
}

export async function pollTogetherVideo(env: Env, jobId: string): Promise<TogetherVideoJob> {
  if (!env.TOGETHER_API_KEY) {
    throw new Error('TOGETHER_API_KEY is not configured');
  }

  const response = await fetch(
    `https://api.together.xyz/v1/videos/generations/${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.TOGETHER_API_KEY}`,
      },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Together video poll error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    id?: string;
    status?: string;
    video_url?: string;
    url?: string;
    error?: string;
    data?: Array<{ url?: string; video_url?: string }>;
  };

  const rawStatus = (json.status ?? 'processing').toLowerCase();
  const status: TogetherVideoJob['status'] =
    rawStatus.includes('complet') || rawStatus === 'succeeded' || rawStatus === 'done'
      ? 'completed'
      : rawStatus.includes('fail') || rawStatus === 'error'
        ? 'failed'
        : 'processing';

  return {
    id: json.id ?? jobId,
    status,
    video_url: json.video_url ?? json.url ?? json.data?.[0]?.video_url ?? json.data?.[0]?.url,
    error: json.error,
  };
}
