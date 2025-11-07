export interface StatusRecord {
  requestId: string;
  currentState: string;
  updatedAt: string;
  summaryForRequester?: string;
  summaryForApprover?: string;
  [key: string]: unknown;
}
