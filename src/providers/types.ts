import type {
  ChatMessage,
  EmbeddingProvider,
  Env,
  ResponseFormat,
  TextProvider,
  Tool,
} from '../types';

export interface ProviderCallInput {
  env: Env;
  provider: TextProvider;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream: boolean;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: ResponseFormat;
}

export interface ProviderCallResult {
  provider: TextProvider;
  model: string;
  stream: boolean;
  completion?: {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: Array<{
      index?: number;
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason?: string | null;
      delta?: {
        content?: string | null;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: 'function';
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  streamSource?: AsyncIterable<unknown>;
}

export type ProviderCaller = (input: ProviderCallInput) => Promise<ProviderCallResult>;

export interface ProviderEmbeddingInput {
  env: Env;
  provider: EmbeddingProvider;
  model: string;
  input: string[];
  encoding_format?: 'float';
  dimensions?: number;
}

export interface ProviderEmbeddingResult {
  provider: EmbeddingProvider;
  model: string;
  response: {
    object: 'list';
    data: Array<{
      object: 'embedding';
      index: number;
      embedding: number[];
    }>;
    model: string;
    usage?: {
      prompt_tokens?: number;
      total_tokens?: number;
    };
  };
}

export type ProviderEmbeddingCaller = (
  input: ProviderEmbeddingInput
) => Promise<ProviderEmbeddingResult>;
