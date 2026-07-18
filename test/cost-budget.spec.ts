import { describe, expect, it } from 'vitest';

import { CostBudget, CostBudgetExceededError } from '../src/lib/cost-budget';

describe('CostBudget', () => {
  it('allows attempts within the budget', () => {
    const budget = new CostBudget({ maxAttempts: 3, maxTotalTimeoutMs: 180_000 });
    expect(budget.canAttempt()).toBe(true);
    budget.recordAttempt(60_000);
    expect(budget.canAttempt()).toBe(true);
    budget.recordAttempt(60_000);
    expect(budget.canAttempt()).toBe(true);
    budget.recordAttempt(60_000);
    expect(budget.canAttempt()).toBe(false);
  });

  it('throws CostBudgetExceededError when attempts exceed max', () => {
    const budget = new CostBudget({ maxAttempts: 1, maxTotalTimeoutMs: 60_000 });
    budget.recordAttempt(60_000);
    expect(() => budget.recordAttempt(60_000)).toThrow(CostBudgetExceededError);
  });

  it('throws when cumulative timeout exceeds max', () => {
    const budget = new CostBudget({ maxAttempts: 5, maxTotalTimeoutMs: 30_000 });
    budget.recordAttempt(20_000);
    expect(() => budget.recordAttempt(20_000)).toThrow(CostBudgetExceededError);
  });

  it('exposes inspectable state', () => {
    const budget = new CostBudget({ maxAttempts: 3, maxTotalTimeoutMs: 180_000 });
    budget.recordAttempt(60_000);
    const state = budget.state();
    expect(state.attempts).toBe(1);
    expect(state.totalTimeoutMs).toBe(60_000);
  });

  it('error message includes attempt and timeout details', () => {
    const budget = new CostBudget({ maxAttempts: 1, maxTotalTimeoutMs: 30_000 });
    budget.recordAttempt(30_000);
    try {
      budget.recordAttempt(30_000);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CostBudgetExceededError);
      const e = err as CostBudgetExceededError;
      expect(e.message).toContain('cost budget exceeded');
      expect(e.message).toContain('2 provider attempts');
      expect(e.attempts).toBe(2);
      expect(e.maxAttempts).toBe(1);
    }
  });
});
