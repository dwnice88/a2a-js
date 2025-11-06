import type { FinanceRequest } from "../../finance/index.js";

export type FinanceRequestFieldKey = Exclude<
  keyof FinanceRequest,
  "requestId" | "metadata"
>;

export interface FinanceIntakeProgress {
  // Assigned when we know we have a full, valid request
  requestId?: string;

  // Request data collected so far from the user (may be incomplete)
  partialRequest: Partial<FinanceRequest>;

  // Fields we believe are filled and valid
  completedFields: FinanceRequestFieldKey[];

  // Fields still missing or invalid according to our rules/LLM
  missingFields: FinanceRequestFieldKey[];

  // Last question we asked the user, used for context / re-ask
  lastQuestion?: string;
}

export interface FinanceIntakeMetadata {
  intake: FinanceIntakeProgress;
}

export const REQUIRED_FIELDS: FinanceRequestFieldKey[] = [
  "directorate",
  "serviceName",
  "costCentreCode",
  "typeOfSpend",
  "amountExclVAT",
  "ringFencedFunding",
  "isBusinessCritical",
  "isStatutory",
  "canBeDeferred",
  "hasContractInPlace",
  "descriptionOfSpend",
  "justification",
  "headOfFinance",
  "executiveTeamOrDelegate",
  // You can add requesterName/requesterEmail here if those exist in FinanceRequest
];

let requestCounter = 1;

export function generateRequestId(): string {
  const year = new Date().getFullYear();
  const padded = String(requestCounter++).padStart(4, "0");
  return `ESAF-${year}-${padded}`;
}

export interface PlannerInput {
  userText: string;
  partialRequest: Partial<FinanceRequest>;
  missingFields: FinanceRequestFieldKey[];
  completedFields: FinanceRequestFieldKey[];
  lastQuestion?: string;
  mode?: "normal" | "shortcut";
}

export interface PlannerOutput {
  updatedRequest: Partial<FinanceRequest>;
  missingFields: FinanceRequestFieldKey[];
  completedFields: FinanceRequestFieldKey[];
  nextQuestion: string | null;
  isComplete: boolean;
}
