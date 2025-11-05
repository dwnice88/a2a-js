// src/finance/examples.ts
// Non-production example objects for documentation, tests, or manual experiments.

import { FinanceRequest, PolicyDecision, StatusRecord } from './domain';

export const exampleFinanceRequest: FinanceRequest = {
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

export const examplePolicyDecision: PolicyDecision = {
  decisionState: 'needs_manager_approval',
  requiredApprovalPath: 'manager_only',
  reasons: [
    {
      code: 'below_threshold',
      message: 'Amount is at or below the manager approval threshold.',
    },
  ],
};

export const exampleStatusRecord: StatusRecord = {
  requestId: 'ESAF-2025-0001',
  currentState: 'awaiting_manager_approval',
  updatedAt: new Date().toISOString(),
  updatedBy: 'policy',
  policyDecision: examplePolicyDecision,
  history: [
    {
      state: 'submitted',
      updatedAt: new Date().toISOString(),
      updatedBy: 'intake',
      note: 'Request submitted by requester.',
    },
  ],
};
