/**
 * Per-request cost budget for expensive multi-modal generation (image/video).
 *
 * Tracks provider attempts and cumulative timeout budget so a single request
 * cannot fan out into unbounded provider work. When the budget is exceeded the
 * caller receives an inspectable reason rather than a silent hang or runaway
 * compute spend.
 *
 * This is distinct from NeuronBudgetDO (which caps *Workers AI* daily neuron
 * spend across all requests). CostBudget is per-request and provider-agnostic.
 */

export interface CostBudgetOptions {
  /** Maximum number of provider attempts before the budget is exhausted. */
  maxAttempts: number;
  /** Maximum cumulative timeout (ms) across all attempts. */
  maxTotalTimeoutMs: number;
}

export interface CostBudgetState {
  attempts: number;
  totalTimeoutMs: number;
}

export class CostBudgetExceededError extends Error {
  readonly attempts: number;
  readonly totalTimeoutMs: number;
  readonly maxAttempts: number;
  readonly maxTotalTimeoutMs: number;

  constructor(state: CostBudgetState, options: CostBudgetOptions) {
    super(
      `cost budget exceeded: ${state.attempts} provider attempts, ${state.totalTimeoutMs}ms total timeout ` +
        `(max ${options.maxAttempts} attempts, ${options.maxTotalTimeoutMs}ms)`
    );
    this.name = 'CostBudgetExceededError';
    this.attempts = state.attempts;
    this.totalTimeoutMs = state.totalTimeoutMs;
    this.maxAttempts = options.maxAttempts;
    this.maxTotalTimeoutMs = options.maxTotalTimeoutMs;
  }
}

export class CostBudget {
  private attempts = 0;
  private totalTimeoutMs = 0;
  private readonly options: CostBudgetOptions;

  constructor(options: CostBudgetOptions) {
    this.options = options;
  }

  /** Record an attempt with its per-call timeout. Throws if the budget is exceeded. */
  recordAttempt(timeoutMs: number): void {
    this.attempts += 1;
    this.totalTimeoutMs += timeoutMs;

    if (this.attempts > this.maxAttempts || this.totalTimeoutMs > this.maxTotalTimeoutMs) {
      throw new CostBudgetExceededError(this.state(), this.options);
    }
  }

  /** Whether another attempt is allowed without recording it. */
  canAttempt(): boolean {
    return this.attempts < this.maxAttempts && this.totalTimeoutMs < this.maxTotalTimeoutMs;
  }

  state(): CostBudgetState {
    return { attempts: this.attempts, totalTimeoutMs: this.totalTimeoutMs };
  }

  get maxAttempts(): number {
    return this.options.maxAttempts;
  }

  get maxTotalTimeoutMs(): number {
    return this.options.maxTotalTimeoutMs;
  }
}
