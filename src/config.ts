import type {
  AudioSttModelCandidate,
  AudioSttProvider,
  AudioTtsModelCandidate,
  AudioTtsProvider,
  Env,
  ImageModelCandidate,
  ImageProvider,
  ModelCandidate,
  Provider,
  ProviderLimitConfig,
  ReasoningEffort,
  ReasoningTier,
  TextProvider,
  VideoModelCandidate,
  VideoProvider,
} from './types';
// ═══════════════════════════════════════════════════════════════════
// Multi-modal registries: image, video, TTS, STT
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_MODELS: ModelCandidate[] = [
  // ── Workers AI (free via Cloudflare binding / REST) ─────────────────
  {
    id: 'workers-ai-llama-3.3-70b',
    provider: 'workers_ai',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.93,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'workers-ai-deepseek-r1-32b',
    provider: 'workers_ai',
    model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.9,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'workers-ai-llama-8b',
    provider: 'workers_ai',
    model: '@cf/meta/llama-3.1-8b-instruct',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.92,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'workers-ai-mistral-7b',
    provider: 'workers_ai',
    model: '@cf/mistral/mistral-7b-instruct-v0.1',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.88,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 8192,
      maxOutputTokens: 2048,
    },
  },
  {
    id: 'workers-ai-llama-3b',
    provider: 'workers_ai',
    model: '@cf/meta/llama-3.2-3b-instruct',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.83,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'workers-ai-llama-1b',
    provider: 'workers_ai',
    model: '@cf/meta/llama-3.2-1b-instruct',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'workers-ai-phi-2',
    provider: 'workers_ai',
    model: '@cf/microsoft/phi-2',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.75,
    capabilities: {
      toolCalling: false,
      jsonMode: false,
      vision: false,
      contextWindow: 2048,
      maxOutputTokens: 1024,
    },
  },

  // ── Groq (free tier, rate-limited) ──────────────────────────────────
  {
    id: 'groq-llama-70b',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.91,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 32768,
    },
  },
  {
    id: 'groq-gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.89,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'groq-gpt-oss-20b',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.87,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'groq-qwen3-32b',
    provider: 'groq',
    model: 'qwen/qwen3-32b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.86,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'groq-llama4-scout',
    provider: 'groq',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.84,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'groq-llama-8b',
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.91,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },

  // ── Gemini (free tier, generous limits) ─────────────────────────────
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.92,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 1048576,
      maxOutputTokens: 65536,
    },
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.87,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 1048576,
      maxOutputTokens: 8192,
    },
  },

  // ── OpenRouter (needs OPENROUTER_API_KEY) ────────────────────────────
  {
    id: 'openrouter-hermes-405b-free',
    provider: 'openrouter',
    model: 'nousresearch/hermes-3-llama-3.1-405b:free',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.79,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-llama-70b-free',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-gpt-oss-120b-free',
    provider: 'openrouter',
    model: 'openai/gpt-oss-120b:free',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.77,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'openrouter-qwen3-next-80b-free',
    provider: 'openrouter',
    model: 'qwen/qwen3-next-80b-a3b-instruct:free',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.76,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'openrouter-qwen3-coder-free',
    provider: 'openrouter',
    model: 'qwen/qwen3-coder:free',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.73,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'openrouter-nvidia-nemotron-12b-free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-nano-12b-v2-vl:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.7,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: true,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-llama-3.2-3b-free',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.2-3b-instruct:free',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.68,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },

  // ── Cerebras (needs CEREBRAS_API_KEY) ───────────────────────────────
  {
    id: 'cerebras-gpt-oss-120b',
    provider: 'cerebras',
    model: 'gpt-oss-120b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.77,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },

  // ── SambaNova (free tier, needs SAMBANOVA_API_KEY) ─────────────────
  {
    id: 'sambanova-llama-70b',
    provider: 'sambanova',
    model: 'Meta-Llama-3.3-70B-Instruct',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.76,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'sambanova-deepseek-v3',
    provider: 'sambanova',
    model: 'DeepSeek-V3-0324',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.75,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'sambanova-qwen3-32b',
    provider: 'sambanova',
    model: 'Qwen3-32B',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.74,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },

  // ── NVIDIA NIM (free tier, needs NVIDIA_API_KEY) ───────────────────
  {
    id: 'nvidia-llama-70b',
    provider: 'nvidia',
    model: 'meta/llama-3.3-70b-instruct',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.73,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-deepseek-r1',
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-r1',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.72,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-qwen-32b',
    provider: 'nvidia',
    model: 'qwen/qwen3-32b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.71,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-nemotron-super-49b',
    provider: 'nvidia',
    model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.74,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-nemotron-70b',
    provider: 'nvidia',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.73,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-llama4-maverick',
    provider: 'nvidia',
    model: 'meta/llama-4-maverick-17b-128e-instruct',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.72,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-deepseek-v3',
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-v3',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.71,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-deepseek-r1-distill-70b',
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-r1-distill-llama-70b',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.69,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'nvidia-qwen-coder-32b',
    provider: 'nvidia',
    model: 'qwen/qwen2.5-coder-32b-instruct',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.68,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },

  // ── GitHub Models (needs GITHUB_TOKEN, free tier) ───────────────────
  {
    id: 'gh-gpt-5',
    provider: 'github_models',
    model: 'openai/gpt-5',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.95,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 272000,
      maxOutputTokens: 16384,
    },
  },
  {
    id: 'gh-gpt-5-mini',
    provider: 'github_models',
    model: 'openai/gpt-5-mini',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.93,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 272000,
      maxOutputTokens: 16384,
    },
  },
  {
    id: 'gh-gpt-5-nano',
    provider: 'github_models',
    model: 'openai/gpt-5-nano',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.88,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 272000,
      maxOutputTokens: 16384,
    },
  },
  {
    id: 'gh-gpt-4.1',
    provider: 'github_models',
    model: 'openai/gpt-4.1',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.91,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 1047576,
      maxOutputTokens: 32768,
    },
  },
  {
    id: 'gh-gpt-4.1-mini',
    provider: 'github_models',
    model: 'openai/gpt-4.1-mini',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.89,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 1047576,
      maxOutputTokens: 32768,
    },
  },
  {
    id: 'gh-gpt-4o-mini',
    provider: 'github_models',
    model: 'openai/gpt-4o-mini',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.86,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 128000,
      maxOutputTokens: 16384,
    },
  },
  {
    id: 'gh-o3',
    provider: 'github_models',
    model: 'openai/o3',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.94,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 200000,
      maxOutputTokens: 100000,
    },
  },
  {
    id: 'gh-o4-mini',
    provider: 'github_models',
    model: 'openai/o4-mini',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.9,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 200000,
      maxOutputTokens: 100000,
    },
  },
  {
    id: 'gh-deepseek-r1',
    provider: 'github_models',
    model: 'deepseek/deepseek-r1',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.87,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 163840,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-deepseek-r1-0528',
    provider: 'github_models',
    model: 'deepseek/deepseek-r1-0528',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.86,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 163840,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-deepseek-v3',
    provider: 'github_models',
    model: 'deepseek/deepseek-v3-0324',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.85,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-llama-4-maverick',
    provider: 'github_models',
    model: 'meta/llama-4-maverick-17b-128e-instruct-fp8',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.82,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-llama-4-scout',
    provider: 'github_models',
    model: 'meta/llama-4-scout-17b-16e-instruct',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.81,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-llama-3.3-70b',
    provider: 'github_models',
    model: 'meta/llama-3.3-70b-instruct',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.83,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-grok-3',
    provider: 'github_models',
    model: 'xai/grok-3',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.84,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-grok-3-mini',
    provider: 'github_models',
    model: 'xai/grok-3-mini',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.8,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-codestral',
    provider: 'github_models',
    model: 'mistral-ai/codestral-2501',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.82,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 262144,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-mistral-medium',
    provider: 'github_models',
    model: 'mistral-ai/mistral-medium-2505',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.79,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-command-a',
    provider: 'github_models',
    model: 'cohere/cohere-command-a',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-command-r-plus',
    provider: 'github_models',
    model: 'cohere/cohere-command-r-plus-08-2024',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.77,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'gh-phi-4',
    provider: 'github_models',
    model: 'microsoft/phi-4',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.72,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 16384,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'gh-phi-4-reasoning',
    provider: 'github_models',
    model: 'microsoft/phi-4-reasoning',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.73,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'gh-mai-ds-r1',
    provider: 'github_models',
    model: 'microsoft/mai-ds-r1',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.74,
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 163840,
      maxOutputTokens: 8192,
    },
  },

  // ── Pollinations (no key required) ──────────────────────────────────
  {
    id: 'pollinations-openai',
    provider: 'pollinations',
    model: 'openai',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.68,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 128000,
      maxOutputTokens: 8192,
    },
  },

  // ── Cohere (trial key, 1000 req/mo) ─────────────────────────────────
  {
    id: 'cohere-command-a',
    provider: 'cohere',
    model: 'command-a-03-2025',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.82,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 256000,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'cohere-command-r-plus',
    provider: 'cohere',
    model: 'command-r-plus-08-2024',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'cohere-command-r',
    provider: 'cohere',
    model: 'command-r-08-2024',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.75,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'cohere-command-r7b',
    provider: 'cohere',
    model: 'command-r7b-12-2024',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.7,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 128000,
      maxOutputTokens: 4096,
    },
  },

  // ── Mistral La Plateforme (Experiment tier, 1 RPS, 500k tok/min) ────
  {
    id: 'mistral-large',
    provider: 'mistral',
    model: 'mistral-large-latest',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.85,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-medium',
    provider: 'mistral',
    model: 'mistral-medium-latest',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.82,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-small',
    provider: 'mistral',
    model: 'mistral-small-latest',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-codestral',
    provider: 'mistral',
    model: 'codestral-latest',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.8,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 262144,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-ministral-8b',
    provider: 'mistral',
    model: 'ministral-8b-latest',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.72,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-ministral-3b',
    provider: 'mistral',
    model: 'ministral-3b-latest',
    reasoning: 'low',
    supportsStreaming: true,
    enabled: true,
    priority: 0.7,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },
  {
    id: 'mistral-pixtral',
    provider: 'mistral',
    model: 'pixtral-large-latest',
    reasoning: 'high',
    supportsStreaming: true,
    enabled: true,
    priority: 0.76,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  },

  // ── Tencent Hy3: official OpenRouter catalog capabilities (2026-07-13) ──
  {
    id: 'openrouter-google-gemma-4-26b-a4b-it-free',
    provider: 'openrouter',
    model: 'google/gemma-4-26b-a4b-it:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-google-gemma-4-31b-it-free',
    provider: 'openrouter',
    model: 'google/gemma-4-31b-it:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-nvidia-nemotron-3-super-120b-a12b-free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-openrouter-free',
    provider: 'openrouter',
    model: 'openrouter/free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-liquid-lfm-2-5-1-2b-thinking-free',
    provider: 'openrouter',
    model: 'liquid/lfm-2.5-1.2b-thinking:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-liquid-lfm-2-5-1-2b-instruct-free',
    provider: 'openrouter',
    model: 'liquid/lfm-2.5-1.2b-instruct:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-nvidia-nemotron-3-nano-30b-a3b-free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-nano-30b-a3b:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-nvidia-nemotron-nano-9b-v2-free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-nano-9b-v2:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-openai-gpt-oss-20b-free',
    provider: 'openrouter',
    model: 'openai/gpt-oss-20b:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-cognitivecomputations-dolphin-mistral-24b-venice-',
    provider: 'openrouter',
    model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },

  // ── Auto-added by weekly model check (review priority + capabilities) ──
  {
    id: 'openrouter-nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-fre',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-poolside-laguna-m-1-free',
    provider: 'openrouter',
    model: 'poolside/laguna-m.1:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },

  // ── Auto-added by weekly model check (review priority + capabilities) ──
  {
    id: 'openrouter-nvidia-nemotron-3-ultra-550b-a55b-free',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'cerebras-zai-glm-4-7',
    provider: 'cerebras',
    model: 'zai-glm-4.7',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },

  // ── Auto-added by weekly model check (review priority + capabilities) ──
  {
    id: 'groq-qwen-qwen3-6-27b',
    provider: 'groq',
    model: 'qwen/qwen3.6-27b',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'openrouter-cohere-north-mini-code-free',
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },

  // ── Auto-added by weekly model check (review priority + capabilities) ──
  {
    id: 'openrouter-poolside-laguna-xs-2-1-free',
    provider: 'openrouter',
    model: 'poolside/laguna-xs-2.1:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },
  {
    id: 'cerebras-gemma-4-31b',
    provider: 'cerebras',
    model: 'gemma-4-31b',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5, // AUTO-ADDED by check-model-ids — review caps + priority
    capabilities: {
      toolCalling: false,
      jsonMode: true,
      vision: false,
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  },

  // ── Auto-added by weekly model check (review priority + capabilities) ──
  {
    id: 'openrouter-tencent-hy3-free',
    provider: 'openrouter',
    model: 'tencent/hy3:free',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.5,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 262_144,
      maxOutputTokens: 262_144,
    },
  },

  // ── Z.ai / Zhipu GLM (free Flash models, OpenAI-compatible) ──────────
  // GLM-4.7-Flash and GLM-4.5-Flash are free; GLM-4.6V-Flash is a free
  // vision model. Previously only reachable via Cerebras/OpenRouter.
  {
    id: 'zai-glm-4-7-flash',
    provider: 'zai',
    model: 'glm-4.7-flash',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.84,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
    },
  },
  {
    id: 'zai-glm-4-5-flash',
    provider: 'zai',
    model: 'glm-4.5-flash',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.8,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: false,
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
    },
  },
  {
    id: 'zai-glm-4-6v-flash',
    provider: 'zai',
    model: 'glm-4.6v-flash',
    reasoning: 'medium',
    supportsStreaming: true,
    enabled: true,
    priority: 0.78,
    capabilities: {
      toolCalling: true,
      jsonMode: true,
      vision: true,
      contextWindow: 65_536,
      maxOutputTokens: 8_192,
    },
  },
];

const DEFAULT_LIMITS: Record<string, ProviderLimitConfig> = {
  // Workers AI
  'workers_ai:@cf/meta/llama-3.3-70b-instruct-fp8-fast': { requestsPerDay: 200 },
  'workers_ai:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { requestsPerDay: 200 },
  'workers_ai:@cf/meta/llama-3.1-8b-instruct': { requestsPerDay: 500 },
  'workers_ai:@cf/mistral/mistral-7b-instruct-v0.1': { requestsPerDay: 500 },
  'workers_ai:@cf/meta/llama-3.2-3b-instruct': { requestsPerDay: 800 },
  'workers_ai:@cf/meta/llama-3.2-1b-instruct': { requestsPerDay: 1000 },
  'workers_ai:@cf/microsoft/phi-2': { requestsPerDay: 800 },
  // Groq
  'groq:llama-3.3-70b-versatile': { requestsPerDay: 300 },
  'groq:openai/gpt-oss-120b': { requestsPerDay: 200 },
  'groq:openai/gpt-oss-20b': { requestsPerDay: 500 },
  'groq:qwen/qwen3-32b': { requestsPerDay: 500 },
  'groq:meta-llama/llama-4-scout-17b-16e-instruct': { requestsPerDay: 500 },
  'groq:llama-3.1-8b-instant': { requestsPerDay: 1500 },
  // Gemini
  'gemini:gemini-2.5-flash': { requestsPerDay: 500 },
  'gemini:gemini-2.5-flash-lite': { requestsPerDay: 1500 },
  // OpenRouter (free models, rate-limited upstream)
  'openrouter:nousresearch/hermes-3-llama-3.1-405b:free': { requestsPerDay: 50 },
  'openrouter:meta-llama/llama-3.3-70b-instruct:free': { requestsPerDay: 50 },
  'openrouter:openai/gpt-oss-120b:free': { requestsPerDay: 50 },
  'openrouter:qwen/qwen3-next-80b-a3b-instruct:free': { requestsPerDay: 50 },
  'openrouter:qwen/qwen3-coder:free': { requestsPerDay: 50 },
  'openrouter:nvidia/nemotron-nano-12b-v2-vl:free': { requestsPerDay: 100 },
  'openrouter:meta-llama/llama-3.2-3b-instruct:free': { requestsPerDay: 100 },
  // Cerebras
  'cerebras:gpt-oss-120b': { requestsPerDay: 300 },
  // SambaNova (free tier, 10-20 RPM)
  'sambanova:Meta-Llama-3.3-70B-Instruct': { requestsPerDay: 500 },
  'sambanova:DeepSeek-V3-0324': { requestsPerDay: 300 },
  'sambanova:Qwen3-32B': { requestsPerDay: 500 },
  // NVIDIA NIM (free tier, ~40 RPM)
  'nvidia:meta/llama-3.3-70b-instruct': { requestsPerDay: 500 },
  'nvidia:deepseek-ai/deepseek-r1': { requestsPerDay: 300 },
  'nvidia:qwen/qwen3-32b': { requestsPerDay: 500 },
  'nvidia:nvidia/llama-3.3-nemotron-super-49b-v1': { requestsPerDay: 500 },
  'nvidia:nvidia/llama-3.1-nemotron-70b-instruct': { requestsPerDay: 500 },
  'nvidia:meta/llama-4-maverick-17b-128e-instruct': { requestsPerDay: 500 },
  'nvidia:deepseek-ai/deepseek-v3': { requestsPerDay: 300 },
  'nvidia:deepseek-ai/deepseek-r1-distill-llama-70b': { requestsPerDay: 300 },
  'nvidia:qwen/qwen2.5-coder-32b-instruct': { requestsPerDay: 500 },
  // GitHub Models (free tier ~50 req/day per high-tier, 150/day low-tier)
  'github_models:openai/gpt-5': { requestsPerDay: 50 },
  'github_models:openai/gpt-5-mini': { requestsPerDay: 150 },
  'github_models:openai/gpt-5-nano': { requestsPerDay: 150 },
  'github_models:openai/gpt-4.1': { requestsPerDay: 50 },
  'github_models:openai/gpt-4.1-mini': { requestsPerDay: 150 },
  'github_models:openai/gpt-4o-mini': { requestsPerDay: 150 },
  'github_models:openai/o3': { requestsPerDay: 50 },
  'github_models:openai/o4-mini': { requestsPerDay: 50 },
  'github_models:deepseek/deepseek-r1': { requestsPerDay: 50 },
  'github_models:deepseek/deepseek-r1-0528': { requestsPerDay: 50 },
  'github_models:deepseek/deepseek-v3-0324': { requestsPerDay: 50 },
  'github_models:meta/llama-4-maverick-17b-128e-instruct-fp8': { requestsPerDay: 150 },
  'github_models:meta/llama-4-scout-17b-16e-instruct': { requestsPerDay: 150 },
  'github_models:meta/llama-3.3-70b-instruct': { requestsPerDay: 150 },
  'github_models:xai/grok-3': { requestsPerDay: 50 },
  'github_models:xai/grok-3-mini': { requestsPerDay: 150 },
  'github_models:mistral-ai/codestral-2501': { requestsPerDay: 150 },
  'github_models:mistral-ai/mistral-medium-2505': { requestsPerDay: 150 },
  'github_models:cohere/cohere-command-a': { requestsPerDay: 150 },
  'github_models:cohere/cohere-command-r-plus-08-2024': { requestsPerDay: 150 },
  'github_models:microsoft/phi-4': { requestsPerDay: 150 },
  'github_models:microsoft/phi-4-reasoning': { requestsPerDay: 150 },
  'github_models:microsoft/mai-ds-r1': { requestsPerDay: 50 },
  // Pollinations (no key required, IP-rate-limited upstream)
  'pollinations:openai': { requestsPerDay: 300 },
  // Cohere (trial: 1000 req/mo ≈ 33/day across all models)
  'cohere:command-a-03-2025': { requestsPerDay: 10 },
  'cohere:command-r-plus-08-2024': { requestsPerDay: 10 },
  'cohere:command-r-08-2024': { requestsPerDay: 10 },
  'cohere:command-r7b-12-2024': { requestsPerDay: 10 },
  // Mistral (Experiment tier, generous but 1 RPS)
  'mistral:mistral-large-latest': { requestsPerDay: 500 },
  'mistral:mistral-medium-latest': { requestsPerDay: 500 },
  'mistral:mistral-small-latest': { requestsPerDay: 1000 },
  'mistral:codestral-latest': { requestsPerDay: 500 },
  'mistral:ministral-8b-latest': { requestsPerDay: 1000 },
  'mistral:ministral-3b-latest': { requestsPerDay: 1000 },
  'mistral:pixtral-large-latest': { requestsPerDay: 300 },
  // AUTO-ADDED limits
  'openrouter:google/gemma-4-26b-a4b-it:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:google/gemma-4-31b-it:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:nvidia/nemotron-3-super-120b-a12b:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:openrouter/free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:liquid/lfm-2.5-1.2b-thinking:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:liquid/lfm-2.5-1.2b-instruct:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:nvidia/nemotron-3-nano-30b-a3b:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:nvidia/nemotron-nano-9b-v2:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:openai/gpt-oss-20b:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:cognitivecomputations/dolphin-mistral-24b-venice-edition:free': {
    requestsPerDay: 100,
  }, // AUTO-ADDED — tune
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:poolside/laguna-m.1:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'cerebras:zai-glm-4.7': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'groq:qwen/qwen3.6-27b': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:cohere/north-mini-code:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'openrouter:poolside/laguna-xs-2.1:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  'cerebras:gemma-4-31b': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  // AUTO-ADDED limits
  'openrouter:tencent/hy3:free': { requestsPerDay: 100 }, // AUTO-ADDED — tune
  // Z.ai / Zhipu GLM — free Flash models, rate-limited upstream
  'zai:glm-4.7-flash': { requestsPerDay: 200 }, // AUTO-ADDED — tune
  'zai:glm-4.5-flash': { requestsPerDay: 200 }, // AUTO-ADDED — tune
  'zai:glm-4.6v-flash': { requestsPerDay: 100 }, // AUTO-ADDED — tune
};

export interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  capacity: 10,
  refillPerSecond: 20 / 60,
};

const PROVIDER_KEY_REQUIRED: Record<TextProvider, boolean> = {
  workers_ai: true,
  groq: true,
  gemini: true,
  openrouter: true,
  cerebras: true,
  sambanova: true,
  nvidia: true,
  github_models: true,
  pollinations: false,
  cohere: true,
  mistral: true,
  zai: true,
};

export function isWorkersAiEnabled(env: Env): boolean {
  return env.WORKERS_AI_ENABLED === 'true';
}

function safeParse<T>(value: string | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hasProviderKey(env: Env, provider: TextProvider): boolean {
  switch (provider) {
    case 'workers_ai':
      return (
        isWorkersAiEnabled(env) &&
        (Boolean(env.AI) || Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY))
      );
    case 'groq':
      return Boolean(env.GROQ_API_KEY);
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY);
    case 'openrouter':
      return Boolean(env.OPENROUTER_API_KEY);
    case 'cerebras':
      return Boolean(env.CEREBRAS_API_KEY);
    case 'sambanova':
      return Boolean(env.SAMBANOVA_API_KEY);
    case 'nvidia':
      return Boolean(env.NVIDIA_API_KEY);
    case 'github_models':
      return Boolean(env.GITHUB_TOKEN);
    case 'pollinations':
      return true;
    case 'cohere':
      return Boolean(env.COHERE_API_KEY);
    case 'mistral':
      return Boolean(env.MISTRAL_API_KEY);
    case 'zai':
      return Boolean(env.ZAI_API_KEY);
    default:
      return false;
  }
}

function modelHasNativeReasoning(candidate: ModelCandidate): boolean {
  const id = `${candidate.id} ${candidate.model}`.toLowerCase();
  return [
    'deepseek-r1',
    'qwq',
    'qwen3',
    'qwen-3',
    'gpt-oss',
    'openai/gpt-5',
    'openai/o3',
    'openai/o4',
    'phi-4-reasoning',
    'deepseek-reasoning',
    'thinking',
    'reasoning',
  ].some((marker) => id.includes(marker));
}

export function getModelRegistry(env: Env): ModelCandidate[] {
  const configured = safeParse<ModelCandidate[]>(env.MODEL_REGISTRY_JSON);
  const base = configured && configured.length > 0 ? configured : DEFAULT_MODELS;

  return base
    .filter((candidate) => {
      if (!candidate.enabled) {
        return false;
      }

      if (PROVIDER_KEY_REQUIRED[candidate.provider] && !hasProviderKey(env, candidate.provider)) {
        return false;
      }

      return true;
    })
    .map((candidate) => ({
      ...candidate,
      capabilities: {
        ...candidate.capabilities,
        nativeReasoning:
          candidate.capabilities.nativeReasoning ?? modelHasNativeReasoning(candidate),
      },
    }));
}

export function getProviderLimits(env: Env): Record<string, ProviderLimitConfig> {
  return safeParse<Record<string, ProviderLimitConfig>>(env.PROVIDER_LIMITS_JSON) ?? DEFAULT_LIMITS;
}

export function getRateLimitConfig(env: Env): RateLimitConfig {
  return safeParse<RateLimitConfig>(env.RATE_LIMIT_CONFIG_JSON) ?? DEFAULT_RATE_LIMIT;
}

export function getTierOrder(reasoning: ReasoningEffort): ReasoningTier[] {
  switch (reasoning) {
    case 'low':
      return ['low', 'medium', 'high'];
    case 'high':
      return ['high', 'medium', 'low'];
    case 'medium':
      return ['medium', 'high', 'low'];
    default:
      return ['medium', 'low', 'high'];
  }
}

export function getModelKey(provider: Provider, model: string): string {
  return `${provider}:${model}`;
}

const DEFAULT_IMAGE_MODELS: ImageModelCandidate[] = [
  // Together (free via key)
  {
    id: 'flux-schnell',
    provider: 'together',
    model: 'black-forest-labs/FLUX.1-schnell',
    enabled: true,
    priority: 0.9,
  },
  {
    id: 'flux-1.1-pro',
    provider: 'together',
    model: 'black-forest-labs/FLUX.1.1-pro',
    enabled: true,
    priority: 0.85,
  },
  {
    id: 'flux-kontext-pro',
    provider: 'together',
    model: 'black-forest-labs/FLUX.1-kontext-pro',
    enabled: true,
    priority: 0.83,
  },
  {
    id: 'flux-2-dev',
    provider: 'together',
    model: 'black-forest-labs/FLUX.2-dev',
    enabled: true,
    priority: 0.82,
  },
  {
    id: 'flux-2-flex',
    provider: 'together',
    model: 'black-forest-labs/FLUX.2-flex',
    enabled: true,
    priority: 0.8,
  },
  {
    id: 'flux-2-pro',
    provider: 'together',
    model: 'black-forest-labs/FLUX.2-pro',
    enabled: true,
    priority: 0.88,
  },
  {
    id: 'flux-2-max',
    provider: 'together',
    model: 'black-forest-labs/FLUX.2-max',
    enabled: true,
    priority: 0.91,
  },
  // Gemini Imagen
  {
    id: 'imagen-4',
    provider: 'gemini',
    model: 'imagen-4.0-generate-001',
    enabled: true,
    priority: 0.86,
  },
  {
    id: 'gemini-flash-image',
    provider: 'gemini',
    model: 'gemini-2.5-flash-image',
    enabled: true,
    priority: 0.82,
  },
  // Workers AI
  {
    id: 'cf-flux-schnell',
    provider: 'workers_ai',
    model: '@cf/black-forest-labs/flux-1-schnell',
    enabled: true,
    priority: 0.78,
  },
  {
    id: 'cf-sdxl',
    provider: 'workers_ai',
    model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    enabled: true,
    priority: 0.72,
  },
  {
    id: 'cf-dreamshaper',
    provider: 'workers_ai',
    model: '@cf/lykon/dreamshaper-8-lcm',
    enabled: true,
    priority: 0.7,
  },
  // NVIDIA NIM
  {
    id: 'nvidia-flux-schnell',
    provider: 'nvidia',
    model: 'black-forest-labs/flux.1-schnell',
    enabled: true,
    priority: 0.76,
  },
  {
    id: 'nvidia-sdxl',
    provider: 'nvidia',
    model: 'stabilityai/stable-diffusion-xl',
    enabled: false,
    priority: 0.7,
  }, // NVIDIA NIM function id not found (404)
  // Pollinations (no key)
  {
    id: 'pollinations-flux',
    provider: 'pollinations',
    model: 'flux',
    enabled: true,
    priority: 0.6,
  },
  {
    id: 'pollinations-flux-realism',
    provider: 'pollinations',
    model: 'flux-realism',
    enabled: true,
    priority: 0.58,
  },
  {
    id: 'pollinations-turbo',
    provider: 'pollinations',
    model: 'turbo',
    enabled: true,
    priority: 0.55,
  },
];

const DEFAULT_VIDEO_MODELS: VideoModelCandidate[] = [
  {
    id: 'veo-3-audio',
    provider: 'together',
    model: 'google/veo-3.0-audio',
    enabled: true,
    priority: 0.95,
  },
  {
    id: 'veo-3-fast-audio',
    provider: 'together',
    model: 'google/veo-3.0-fast-audio',
    enabled: true,
    priority: 0.93,
  },
  { id: 'veo-2', provider: 'together', model: 'google/veo-2.0', enabled: true, priority: 0.88 },
  { id: 'sora-2', provider: 'together', model: 'openai/sora-2', enabled: true, priority: 0.94 },
  {
    id: 'kling-2.1-master',
    provider: 'together',
    model: 'kwaivgI/kling-2.1-master',
    enabled: true,
    priority: 0.9,
  },
  {
    id: 'kling-2.1-pro',
    provider: 'together',
    model: 'kwaivgI/kling-2.1-pro',
    enabled: true,
    priority: 0.87,
  },
  {
    id: 'kling-2.0-master',
    provider: 'together',
    model: 'kwaivgI/kling-2.0-master',
    enabled: true,
    priority: 0.84,
  },
  {
    id: 'kling-1.6-pro',
    provider: 'together',
    model: 'kwaivgI/kling-1.6-pro',
    enabled: true,
    priority: 0.8,
  },
  {
    id: 'wan-2.6-image',
    provider: 'together',
    model: 'Wan-AI/Wan2.6-image',
    enabled: true,
    priority: 0.78,
    supportsImageToVideo: true,
  },
  {
    id: 'wan-2.2-i2v',
    provider: 'together',
    model: 'Wan-AI/Wan2.2-I2V-A14B',
    enabled: true,
    priority: 0.76,
    supportsImageToVideo: true,
  },
  { id: 'vidu-q1', provider: 'together', model: 'vidu/vidu-q1', enabled: true, priority: 0.74 },
  {
    id: 'seedream-3',
    provider: 'together',
    model: 'ByteDance-Seed/Seedream-3.0',
    enabled: true,
    priority: 0.82,
  },
  {
    id: 'seedream-4',
    provider: 'together',
    model: 'ByteDance-Seed/Seedream-4.0',
    enabled: true,
    priority: 0.85,
  },
];

const DEFAULT_TTS_MODELS: AudioTtsModelCandidate[] = [
  {
    id: 'cf-melotts',
    provider: 'workers_ai',
    model: '@cf/myshell-ai/melotts',
    enabled: true,
    priority: 0.7,
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
];

const DEFAULT_STT_MODELS: AudioSttModelCandidate[] = [
  {
    id: 'groq-whisper-turbo',
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    enabled: true,
    priority: 0.95,
  },
  {
    id: 'groq-whisper-v3',
    provider: 'groq',
    model: 'whisper-large-v3',
    enabled: true,
    priority: 0.9,
  },
  {
    id: 'cf-whisper',
    provider: 'workers_ai',
    model: '@cf/openai/whisper',
    enabled: true,
    priority: 0.75,
  },
  {
    id: 'gemini-audio',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    enabled: true,
    priority: 0.78,
  },
];

const DEFAULT_MODALITY_LIMITS: Record<string, ProviderLimitConfig> = {
  // Image: Together free tier is generous for schnell but paid for pro.
  'together:black-forest-labs/FLUX.1-schnell': { requestsPerDay: 300 },
  'together:black-forest-labs/FLUX.1.1-pro': { requestsPerDay: 100 },
  'together:black-forest-labs/FLUX.1-kontext-pro': { requestsPerDay: 100 },
  'together:black-forest-labs/FLUX.2-dev': { requestsPerDay: 150 },
  'together:black-forest-labs/FLUX.2-flex': { requestsPerDay: 150 },
  'together:black-forest-labs/FLUX.2-pro': { requestsPerDay: 100 },
  'together:black-forest-labs/FLUX.2-max': { requestsPerDay: 50 },
  'gemini:imagen-4.0-generate-001': { requestsPerDay: 50 },
  'gemini:gemini-2.5-flash-image': { requestsPerDay: 200 },
  'workers_ai:@cf/black-forest-labs/flux-1-schnell': { requestsPerDay: 500 },
  'workers_ai:@cf/stabilityai/stable-diffusion-xl-base-1.0': { requestsPerDay: 500 },
  'workers_ai:@cf/lykon/dreamshaper-8-lcm': { requestsPerDay: 500 },
  'nvidia:black-forest-labs/flux.1-schnell': { requestsPerDay: 200 },
  'nvidia:stabilityai/stable-diffusion-xl': { requestsPerDay: 200 },
  'pollinations:flux': { requestsPerDay: 300 },
  'pollinations:flux-realism': { requestsPerDay: 300 },
  'pollinations:turbo': { requestsPerDay: 300 },
  // Video: low per-day on free tier due to cost-per-call.
  'together:google/veo-3.0-audio': { requestsPerDay: 10 },
  'together:google/veo-3.0-fast-audio': { requestsPerDay: 20 },
  'together:google/veo-2.0': { requestsPerDay: 20 },
  'together:openai/sora-2': { requestsPerDay: 10 },
  'together:kwaivgI/kling-2.1-master': { requestsPerDay: 10 },
  'together:kwaivgI/kling-2.1-pro': { requestsPerDay: 15 },
  'together:kwaivgI/kling-2.0-master': { requestsPerDay: 15 },
  'together:kwaivgI/kling-1.6-pro': { requestsPerDay: 20 },
  'together:Wan-AI/Wan2.6-image': { requestsPerDay: 30 },
  'together:Wan-AI/Wan2.2-I2V-A14B': { requestsPerDay: 30 },
  'together:vidu/vidu-q1': { requestsPerDay: 30 },
  'together:ByteDance-Seed/Seedream-3.0': { requestsPerDay: 20 },
  'together:ByteDance-Seed/Seedream-4.0': { requestsPerDay: 15 },
  // TTS
  'workers_ai:@cf/myshell-ai/melotts': { requestsPerDay: 500 },
  // STT
  'groq:whisper-large-v3-turbo': { requestsPerDay: 1000 },
  'groq:whisper-large-v3': { requestsPerDay: 500 },
  'workers_ai:@cf/openai/whisper': { requestsPerDay: 1000 },
  'gemini:gemini-2.5-flash': { requestsPerDay: 500 },
};

// Merge modality limits into DEFAULT_LIMITS at module load.
for (const [key, value] of Object.entries(DEFAULT_MODALITY_LIMITS)) {
  if (!(key in DEFAULT_LIMITS)) {
    DEFAULT_LIMITS[key] = value;
  }
}

const IMAGE_PROVIDER_KEY_REQUIRED: Record<ImageProvider, boolean> = {
  together: true,
  workers_ai: false,
  pollinations: false,
  gemini: true,
  nvidia: true,
};

const _VIDEO_PROVIDER_KEY_REQUIRED: Record<VideoProvider, boolean> = {
  together: true,
};

const _TTS_PROVIDER_KEY_REQUIRED: Record<AudioTtsProvider, boolean> = {
  workers_ai: false,
  groq: true,
};

const _STT_PROVIDER_KEY_REQUIRED: Record<AudioSttProvider, boolean> = {
  groq: true,
  workers_ai: false,
  gemini: true,
};

export function hasImageProviderKey(env: Env, provider: ImageProvider): boolean {
  switch (provider) {
    case 'together':
      return Boolean(env.TOGETHER_API_KEY);
    case 'workers_ai':
      return (
        isWorkersAiEnabled(env) &&
        (Boolean(env.AI) || Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY))
      );
    case 'pollinations':
      return true;
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY);
    case 'nvidia':
      return Boolean(env.NVIDIA_API_KEY);
    default:
      return false;
  }
}

export function hasVideoProviderKey(env: Env, provider: VideoProvider): boolean {
  switch (provider) {
    case 'together':
      return Boolean(env.TOGETHER_API_KEY);
    default:
      return false;
  }
}

export function hasTtsProviderKey(env: Env, provider: AudioTtsProvider): boolean {
  switch (provider) {
    case 'groq':
      return Boolean(env.GROQ_API_KEY);
    case 'workers_ai':
      return (
        isWorkersAiEnabled(env) &&
        (Boolean(env.AI) || Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY))
      );
    default:
      return false;
  }
}

function hasSttProviderKey(env: Env, provider: AudioSttProvider): boolean {
  switch (provider) {
    case 'groq':
      return Boolean(env.GROQ_API_KEY);
    case 'workers_ai':
      return (
        isWorkersAiEnabled(env) &&
        (Boolean(env.AI) || Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_WORKERS_AI_API_KEY))
      );
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY);
    default:
      return false;
  }
}

export function getImageRegistry(env: Env): ImageModelCandidate[] {
  return DEFAULT_IMAGE_MODELS.filter((candidate) => {
    if (!candidate.enabled) return false;
    if (
      IMAGE_PROVIDER_KEY_REQUIRED[candidate.provider] &&
      !hasImageProviderKey(env, candidate.provider)
    ) {
      return false;
    }
    if (
      !IMAGE_PROVIDER_KEY_REQUIRED[candidate.provider] &&
      !hasImageProviderKey(env, candidate.provider)
    ) {
      return false;
    }
    return true;
  });
}

export function getVideoRegistry(env: Env): VideoModelCandidate[] {
  return DEFAULT_VIDEO_MODELS.filter((candidate) => {
    if (!candidate.enabled) return false;
    if (!hasVideoProviderKey(env, candidate.provider)) return false;
    return true;
  });
}

export function getTtsRegistry(env: Env): AudioTtsModelCandidate[] {
  return DEFAULT_TTS_MODELS.filter((candidate) => {
    if (!candidate.enabled) return false;
    if (!hasTtsProviderKey(env, candidate.provider)) return false;
    return true;
  });
}

export function getSttRegistry(env: Env): AudioSttModelCandidate[] {
  return DEFAULT_STT_MODELS.filter((candidate) => {
    if (!candidate.enabled) return false;
    if (!hasSttProviderKey(env, candidate.provider)) return false;
    return true;
  });
}
