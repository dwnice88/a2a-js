import type {
  FinanceRequest,
  PolicyDecision,
  StatusRecord,
  ApproverRole,
  SummaryAudience,
} from "../../finance/index.js";

export type SummaryIntent =
  | "policy_result" // A+B tell C about a policy decision
  | "approver_decision" // D tells C about manager/director decisions
  | "status_query"; // A (or UI) asks C "what's the status?"

export interface SummaryPayloadBase {
  intent: SummaryIntent;
  requestId: string;
}

export interface PolicyResultPayload extends SummaryPayloadBase {
  intent: "policy_result";
  financeRequest: FinanceRequest;
  policyDecision: PolicyDecision;
  // Optional: status snapshot from upstream (can be omitted initially)
  statusRecord?: StatusRecord;
}

export type ApproverDecisionOutcome = "approved" | "rejected";

export interface ApproverDecisionPayload extends SummaryPayloadBase {
  intent: "approver_decision";
  approverRole: ApproverRole;
  outcome: ApproverDecisionOutcome;
  comment?: string;
  statusRecord?: StatusRecord;
}

export interface StatusQueryPayload extends SummaryPayloadBase {
  intent: "status_query";
  audience: SummaryAudience; // "requester" | "approver"
}

export type SummaryPayload =
  | PolicyResultPayload
  | ApproverDecisionPayload
  | StatusQueryPayload;

export interface SummaryMetadataEnvelope {
  summaryPayload?: SummaryPayload;
}

/** What Agent C stores per requestId. */
export interface SummaryStoreRecord {
  financeRequest?: FinanceRequest;
  policyDecision?: PolicyDecision;
  status: StatusRecord;
}
