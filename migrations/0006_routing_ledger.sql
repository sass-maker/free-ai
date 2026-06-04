-- Anonymous routing experiment ledger (no prompt text).
CREATE TABLE IF NOT EXISTS routing_ledger_rollup (
  date TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  prompt_class TEXT NOT NULL,
  outcome TEXT NOT NULL,
  chosen_provider TEXT NOT NULL DEFAULT '',
  chosen_model TEXT NOT NULL DEFAULT '',
  fallback_signature TEXT NOT NULL DEFAULT '',
  quota_signature TEXT NOT NULL DEFAULT 'all_ok',
  request_count INTEGER NOT NULL DEFAULT 0,
  sum_latency_ms INTEGER NOT NULL DEFAULT 0,
  sum_attempts INTEGER NOT NULL DEFAULT 0,
  with_fallback INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (
    date,
    project_id,
    prompt_class,
    outcome,
    chosen_provider,
    chosen_model,
    fallback_signature,
    quota_signature
  )
);

CREATE INDEX IF NOT EXISTS idx_routing_ledger_project_date
  ON routing_ledger_rollup (project_id, date);

CREATE INDEX IF NOT EXISTS idx_routing_ledger_prompt_class
  ON routing_ledger_rollup (prompt_class, date);
