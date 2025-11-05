import type { SpendType } from './domain';

export interface FinancePolicyConfig {
  /** Max amount the manager can approve alone (exclusive of VAT). */
  managerOnlyMax: number;
  /** Min amount that requires both manager and director. */
  managerAndDirectorMin: number;
  /** Types of spend that are never allowed. */
  disallowedSpendTypes: SpendType[];
}

/**
 * Shared policy configuration used by the Policy Agent.
 * For the PoC, values are simple and hard-coded.
 */
export const financePolicyConfig: FinancePolicyConfig = {
  managerOnlyMax: 20000,
  managerAndDirectorMin: 20000.01,
  disallowedSpendTypes: [
    // Example disallowed categories – adjust when you know the real list.
    'travel',
  ],
} as const;
