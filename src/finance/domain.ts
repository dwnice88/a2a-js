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

/** Core data that represents an Essential Spend Authorisation request. */
export interface FinanceRequest {
  /** System-generated unique ID, e.g. ESAF-2025-0001. */
  requestId: string;

  /** High-level directorate owning this spend (from the ESAF dropdown). */
  directorate: string;

  /** Service name chosen on the ESAF form. */
  serviceName: string;

  /** Cost Centre / Project Code from the ESAF form. */
  costCentreCode: string;

  /** Type of spend (maps to the ESAF “Type of Spend”). */
  typeOfSpend: SpendType;

  /** Amount in £ (excluding VAT) from the ESAF form. */
  amountExclVAT: Money;

  /** Whether the funding is ring-fenced (ESAFT “Ring-fenced Funding”). */
  ringFencedFunding: string; // e.g. "Yes", "No", or a coded value

  /** Is this spend business critical? (Yes/No on ESAF). */
  isBusinessCritical: string; // we can normalise to boolean later

  /** Is this spend statutory? (Yes/No on ESAF). */
  isStatutory: string;

  /**
   * Could the spend be deferred to a future date / financial year?
   * (Yes/No on ESAF).
   */
  canBeDeferred: string;

  /** Is there a contract in place? (Yes/No on ESAF). */
  hasContractInPlace: string;

  /** Short description of spend from the ESAF form. */
  descriptionOfSpend: string;

  /**
   * Justification / Critical Business Need text.
   * Long free-text area on ESAF.
   */
  justification: string;

  /** Head of Finance selected on ESAF. */
  headOfFinance: string;

  /** Executive Team (or delegate) selected on ESAF. */
  executiveTeamOrDelegate: string;

  /** Optional: requester identity if you need it for the PoC. */
  requesterName?: string;
  requesterEmail?: string;

  /** Optional arbitrary metadata for agents. */
  metadata?: Record<string, unknown>;
}

// Example object to keep TS honest during development (not exported).
const __exampleFinanceRequest: FinanceRequest = {
  requestId: 'ESAF-2025-0001',
  directorate: "Adults' Care & Support",
  serviceName: 'Adult Social Care',
  costCentreCode: 'AC1234',
  typeOfSpend: 'services',
  amountExclVAT: { amount: 10000, currency: 'GBP' },
  ringFencedFunding: 'No',
  isBusinessCritical: 'Yes',
  isStatutory: 'No',
  canBeDeferred: 'No',
  hasContractInPlace: 'Yes',
  descriptionOfSpend: 'Emergency accommodation for vulnerable resident.',
  justification:
    'Without this spend the resident would be at immediate risk; there is no alternative provision.',
  headOfFinance: 'Jane Smith',
  executiveTeamOrDelegate: 'Executive Director – People',
};
