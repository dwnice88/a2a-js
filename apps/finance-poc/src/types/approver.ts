export type ApproverRole = "manager" | "director";

export interface ApproverInboxItem {
  requestId: string;
  approverRole: ApproverRole;
  createdAt: string;
  summaryForApprover: string;
  directorate?: string;
  serviceName?: string;
  amountLabel?: string;
}

export interface ApproverListResponse {
  items: ApproverInboxItem[];
  summaryText?: string;
}

export type ApproverDecisionOutcome =
  | "approved"
  | "rejected"
  | "more_info_requested";

export interface ApproverDecisionRequest {
  requestId: string;
  role: ApproverRole;
  outcome: ApproverDecisionOutcome;
  comment?: string;
}
