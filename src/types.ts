export type TextProvider = 'workers_ai' | 'groq' | 'gemini' | 'openrouter' | 'cerebras' | 'sambanova' | 'nvidia' | 'github_models' | 'pollinations' | 'cohere' | 'mistral';

export type EmbeddingProvider = 'workers_ai' | 'gemini' | 'voyage_ai';

export type ImageProvider = 'together' | 'workers_ai' | 'pollinations' | 'gemini' | 'nvidia';

export type VideoProvider = 'together';

export type AudioTtsProvider = 'workers_ai' | 'groq';

export type AudioSttProvider = 'groq' | 'workers_ai' | 'gemini';

export type Provider = TextProvider | EmbeddingProvider | ImageProvider | VideoProvider | AudioTtsProvider | AudioSttProvider;

export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export type FailureClass =
  | 'safety_refusal'
  | 'usage_retriable'
  | 'input_nonretriable'
  | 'provider_fatal';

export type ReasoningTier = Exclude<ReasoningEffort, 'auto'>;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentPartText {
  type: 'text';
  text: string;
}

export interface ContentPartImageUrl {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = ContentPartText | ContentPartImageUrl;

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
  name?: string;
}

export interface ModelCapabilities {
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelCandidate {
  id: string;
  provider: TextProvider;
  model: string;
  reasoning: ReasoningTier;
  supportsStreaming: boolean;
  enabled: boolean;
  priority: number;
  capabilities: ModelCapabilities;
}

export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';

export interface ImageModelCandidate {
  id: string;
  provider: ImageProvider;
  model: string;
  enabled: boolean;
  priority: number;
  supportedSizes?: ImageSize[];
}

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

export interface VideoModelCandidate {
  id: string;
  provider: VideoProvider;
  model: string;
  enabled: boolean;
  priority: number;
  supportsImageToVideo?: boolean;
  maxDurationSeconds?: number;
}

export interface AudioTtsModelCandidate {
  id: string;
  provider: AudioTtsProvider;
  model: string;
  enabled: boolean;
  priority: number;
  voices?: string[];
}

export interface AudioSttModelCandidate {
  id: string;
  provider: AudioSttProvider;
  model: string;
  enabled: boolean;
  priority: number;
}

export interface ProviderLimitConfig {
  requestsPerDay: number;
}

export interface ModelStateSnapshot {
  key: string;
  attempts: number;
  successRate: number;
  avgLatencyMs: number;
  p90LatencyMs: number;
  p99LatencyMs: number;
  cooldownUntil: number;
  headroom: number;
  dailyUsed: number;
  dailyLimit: number | null;
  shortRetriableFailures: number;
}

export interface ModelEvaluationSnapshot {
  qualityScore: number;
  taskSuccessRate: number;
  freshness: number;
  sampleCount: number;
  evaluatedAt?: string;
}

export interface AttemptRecord {
  ts: number;
  latencyMs: number;
  success: boolean;
  failureClass?: FailureClass;
}

export interface GatewayMeta {
  provider: Provider;
  model: string;
  attempts: number;
  reasoning_effort: ReasoningEffort;
  request_id: string;
  project_id?: string;
}

export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
}

export interface ResponseFormat {
  type: 'text' | 'json_object';
}

export interface NormalizedChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort: ReasoningEffort;
  min_reasoning_level?: ReasoningTier;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: ResponseFormat;
}

export interface GatewayError {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export interface Env {
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  GATEWAY_DB: D1Database;
  HEALTH_DO: DurableObjectNamespace;
  RATE_LIMIT_DO: DurableObjectNamespace;
  NEURON_BUDGET?: DurableObjectNamespace;
  HEALTH_KV: KVNamespace;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  VOYAGE_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_WORKERS_AI_API_KEY?: string;
  WORKERS_AI_ENABLED?: string;
  GATEWAY_API_KEY?: string;
  GATEWAY_API_KEY_HASHES?: string;
  OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  SAMBANOVA_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  GITHUB_TOKEN?: string;
  COHERE_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  TOGETHER_API_KEY?: string;
  MODEL_REGISTRY_JSON?: string;
  MODEL_EVALUATIONS_JSON?: string;
  PROVIDER_LIMITS_JSON?: string;
  RATE_LIMIT_CONFIG_JSON?: string;
  DOCS_SITE_URL?: string;
  POSTHOG_API_KEY?: string;
}
