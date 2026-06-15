/**
 * Budget — token budget enforcement.
 * Hard-fails if projected cost exceeds max_cost_per_review.
 */

import { estimateTokens, calculateCost, type SieveConfig, type TokenUsage } from '../types.js';

export interface BudgetCheck {
  withinBudget: boolean;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  projectedCost: number;
  budgetLimit: number;
  model: string;
}

/**
 * Check if a prompt is within the token budget.
 * Estimates output tokens as ~25% of input tokens (typical for structured JSON).
 */
export function checkBudget(
  prompt: string,
  config: SieveConfig
): BudgetCheck {
  const estimatedInputTokens = estimateTokens(prompt);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.25);
  const projectedCost = calculateCost(config.model, estimatedInputTokens, estimatedOutputTokens);

  return {
    withinBudget: projectedCost <= config.max_cost_per_review,
    estimatedInputTokens,
    estimatedOutputTokens,
    projectedCost,
    budgetLimit: config.max_cost_per_review,
    model: config.model,
  };
}

/**
 * Format a budget check failure as a readable error message.
 */
export function formatBudgetError(check: BudgetCheck): string {
  return [
    '',
    '🚫 TOKEN BUDGET EXCEEDED',
    '━'.repeat(50),
    `   Model:              ${check.model}`,
    `   Est. input tokens:  ${check.estimatedInputTokens.toLocaleString()}`,
    `   Est. output tokens: ${check.estimatedOutputTokens.toLocaleString()}`,
    `   Projected cost:     $${check.projectedCost.toFixed(4)}`,
    `   Budget limit:       $${check.budgetLimit.toFixed(4)}`,
    `   Over by:            $${(check.projectedCost - check.budgetLimit).toFixed(4)}`,
    '',
    '   To proceed anyway, use --force flag.',
    '   To increase the budget, edit max_cost_per_review in sieve.config.json.',
    '━'.repeat(50),
    '',
  ].join('\n');
}

/**
 * Format token usage for display after a successful review.
 */
export function formatTokenUsage(usage: TokenUsage, model: string): string {
  return [
    '',
    '💰 Token Usage',
    '━'.repeat(40),
    `   Model:         ${model}`,
    `   Input tokens:  ${usage.input.toLocaleString()}`,
    `   Output tokens: ${usage.output.toLocaleString()}`,
    `   Cost:          $${usage.estimated_cost_usd.toFixed(4)}`,
    '━'.repeat(40),
  ].join('\n');
}
