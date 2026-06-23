export interface EmbeddingModelSmokeOptions {
  baseUrl?: string;
  model?: string;
  requireEnabled?: boolean;
  fetchImpl?: typeof fetch;
}

export interface EmbeddingModelSmokeReport {
  ok: boolean;
  base_url: string;
  model: string;
  status: number | null;
  embedding_model_count: number;
  selected: {
    id: string;
    provider: string | null;
    dimensions: number | null;
    supports_dimensions: boolean;
    aliases: string[];
    priority: number | null;
    enabled: boolean;
  } | null;
  error: string | null;
}

export function runEmbeddingModelCatalogSmoke(
  options?: EmbeddingModelSmokeOptions
): Promise<EmbeddingModelSmokeReport>;
