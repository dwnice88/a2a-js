import type {
  FinanceRequest,
  PolicyDecision,
  StatusRecord,
  ApproverRole,
} from "../../finance/index.js";

export type ApproverIntent =
  | "notify_approval_required"
  | "create_approval_task"
  | "list_pending"
  | "submit_decision";

export interface ApproverPayloadBase {
  intent: ApproverIntent;
}

export interface CreateApprovalTaskPayload extends ApproverPayloadBase {
  intent: "create_approval_task";
  requestId: string;
  approverRole: ApproverRole;
  financeRequest: FinanceRequest;
  policyDecision: PolicyDecision;
  statusRecord: StatusRecord;
  summaryForApprover: string;
}

export interface NotifyApprovalRequiredPayload extends ApproverPayloadBase {
  intent: "notify_approval_required";
  requestId: string;
  role: ApproverRole;
  summaryForApprover: string;
  statusRecord: StatusRecord;
  financeRequest?: ApproverInboxFinanceRequest;
  policyDecision?: PolicyDecision;
}

export interface ListPendingPayload extends ApproverPayloadBase {
  intent: "list_pending";
  role: ApproverRole;
}

export interface SubmitDecisionPayload extends ApproverPayloadBase {
  intent: "submit_decision";
  requestId: string;
  role: ApproverRole;
  outcome: "approved" | "rejected" | "more_info_requested";
  comment?: string;
}

export type ApproverPayload =
  | NotifyApprovalRequiredPayload
  | CreateApprovalTaskPayload
  | ListPendingPayload
  | SubmitDecisionPayload;

export interface ApproverMetadataEnvelope {
  approverPayload?: ApproverPayload;
}

export type ApproverInboxFinanceRequest = Pick<
  FinanceRequest,
  "directorate" | "serviceName" | "amountExclVAT" | "descriptionOfSpend"
>;

export interface ApproverInboxItem {
  requestId: string;
  approverRole: ApproverRole;
  createdAt: string;
  summaryForApprover: string;
  financeRequest?: ApproverInboxFinanceRequest;
  policyDecision?: PolicyDecision;
  statusSnapshot: StatusRecord;
}

export type { ApproverRole };
