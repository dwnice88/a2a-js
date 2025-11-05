// src/finance/domain.ts
// Shared finance domain types used by all finance-related agents.

export type CurrencyCode = 'GBP';

export interface Money {
  amount: number; // Numeric amount, e.g. 10000 (in smallest unit you choose)
  currency: CurrencyCode; // For now always 'GBP'
}

export type SpendType =
  | 'goods'
  | 'services'
  | 'consultancy'
  | 'travel'
  | 'grants'
  | 'other';

export type ApproverRole = 'manager' | 'director';

export type ApprovalPath =
  | 'none'
  | 'manager_only'
  | 'manager_and_director';
