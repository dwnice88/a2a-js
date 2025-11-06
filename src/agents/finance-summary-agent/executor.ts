import { v4 as uuidv4 } from "uuid";
import { A2AClient } from "../../client/index.js";
import { AGENT_CARD_PATH } from "../../constants.js";

import type { Task, TaskStatusUpdateEvent, Message } from "../../index.js";

import type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "../../server/index.js";

import { getCurrentTimestamp } from "../../server/utils.js";

import type {
  SummaryMetadataEnvelope,
  PolicyResultPayload,
  ApproverDecisionPayload,
  StatusQueryPayload,
  SummaryStoreRecord,
} from "./types.js";
import { generateSummaries } from "./summariser.js";
import type {
  FinanceRequest,
  PolicyDecision,
  StatusRecord,
  RequestLifecycleState,
  ApproverRole,
} from "../../finance/index.js";
import type {
  ApproverMetadataEnvelope,
  NotifyApprovalRequiredPayload,
} from "../finance-approver-agent/types.js";
import type {
  MessageSendParams,
  SendMessageResponse,
  JSONRPCErrorResponse,
} from "../../types.js";

const FINANCE_SUMMARY_DEBUG =
  process.env.FINANCE_SUMMARY_DEBUG === "1" ||
  process.env.FINANCE_SUMMARY_DEBUG === "true";
const DEFAULT_APPROVER_AGENT_URL =
  process.env.FINANCE_APPROVER_AGENT_URL ?? "http://localhost:41004";
const NORMALISED_APPROVER_AGENT_URL =
  DEFAULT_APPROVER_AGENT_URL.replace(/\/+$/, "");

export function logInfo(message: string, ...args: unknown[]) {
  console.log("[FinanceSummary]", message, ...args);
}

export function logDebug(message: string, ...args: unknown[]) {
  if (FINANCE_SUMMARY_DEBUG) {
    console.debug("[FinanceSummary][debug]", message, ...args);
  }
}

export function logError(message: string, ...args: unknown[]) {
  console.error("[FinanceSummary][error]", message, ...args);
}

function initStatusRecord(requestId: string): StatusRecord {
  const now = getCurrentTimestamp();
  return {
    requestId,
    currentState: "submitted",
    updatedAt: now,
    updatedBy: "summary",
    history: [
      {
        state: "submitted",
        updatedAt: now,
        updatedBy: "summary",
        note: "Summary agent initialised record.",
      },
    ],
  };
}

export class FinanceSummaryAgentExecutor implements AgentExecutor {
  private readonly store = new Map<string, SummaryStoreRecord>();
  private approverClientPromise: Promise<A2AClient> | null = null;

  public async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, task: existingTask, taskId, contextId } =
      requestContext;

    const envelope = (userMessage.metadata ?? {}) as SummaryMetadataEnvelope;
    const payload = envelope.summaryPayload;

    if (!payload) {
      logError(
        `No summaryPayload metadata provided for task ${taskId}; cannot proceed.`,
      );
      const agentMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text: "Summary agent requires metadata.summaryPayload to operate.",
          },
        ],
        taskId,
        contextId,
      };

      const failedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: agentMessage,
          timestamp: getCurrentTimestamp(),
        },
        final: true,
      };

      eventBus.publish(failedUpdate);
      eventBus.finished();
      return;
    }

    if (payload.intent === "policy_result" || payload.intent === "policy_decided") {
      await this.handlePolicyResult(
        payload as PolicyResultPayload,
        existingTask,
        taskId,
        contextId,
        userMessage,
        eventBus,
      );
      return;
    }

    if (payload.intent === "approver_decision") {
      await this.handleApproverDecision(
        payload as ApproverDecisionPayload,
        existingTask,
        taskId,
        contextId,
        userMessage,
        eventBus,
      );
      return;
    }

    if (payload.intent === "status_query") {
      await this.handleStatusQuery(
        payload as StatusQueryPayload,
        existingTask,
        taskId,
        contextId,
        userMessage,
        eventBus,
      );
      return;
    }

    logError(`Unsupported summary intent '${payload.intent}' encountered.`);
    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [
        {
          kind: "text",
          text: "Summary agent intent not implemented yet.",
        },
      ],
      taskId,
      contextId,
    };

    const failedUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "failed",
        message: agentMessage,
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };
    eventBus.publish(failedUpdate);
    eventBus.finished();
  }

  public async cancelTask(
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const contextId = `summary-${taskId}`;
    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "canceled",
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };
    eventBus.publish(update);
    eventBus.finished();
  }

  private async getApproverClient(): Promise<A2AClient> {
    if (!this.approverClientPromise) {
      const cardUrl = `${NORMALISED_APPROVER_AGENT_URL}/${AGENT_CARD_PATH}`;
      this.approverClientPromise = A2AClient.fromCardUrl(cardUrl);
      logInfo(
        `Initialised Finance Approver Agent client using Agent Card at ${cardUrl}.`,
      );
    }

    return this.approverClientPromise;
  }

  private async handlePolicyResult(
    payload: PolicyResultPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const now = getCurrentTimestamp();
    const { requestId, financeRequest, policyDecision } = payload;

    let record = this.store.get(requestId);
    if (!record) {
      record = {
        financeRequest,
        policyDecision,
        status: initStatusRecord(requestId),
      };
    } else {
      record.financeRequest = financeRequest;
      record.policyDecision = policyDecision;
    }

    const nextState = this.getStateFromPolicyDecision(policyDecision);
    const historyNote = this.buildPolicyHistoryNote(policyDecision);

    record.status = {
      ...record.status,
      currentState: nextState,
      updatedAt: now,
      updatedBy: "summary",
      policyDecision,
      history: [
        ...record.status.history,
        {
          state: nextState,
          updatedAt: now,
          updatedBy: "summary",
          note: historyNote,
        },
      ],
    };

    const summaries = await generateSummaries(record);
    record.status.summaryForRequester = summaries.summaryForRequester;
    record.status.summaryForApprover = summaries.summaryForApprover;

    this.store.set(requestId, record);

    await this.notifyApproversIfRequired(
      record,
      policyDecision,
      summaries.summaryForApprover,
    );

    const task: Task = existingTask ?? {
      kind: "task",
      id: taskId,
      contextId,
      status: {
        state: "submitted",
        timestamp: now,
      },
      history: [userMessage],
      metadata: {},
    };

    task.metadata = {
      ...(task.metadata ?? {}),
      statusRecord: record.status,
    };

    eventBus.publish(task);

    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: summaries.summaryForRequester }],
      taskId,
      contextId,
    };

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        message: agentMessage,
        timestamp: now,
      },
      final: true,
    };

    eventBus.publish(statusUpdate);
    eventBus.finished();

    logInfo(
      `Stored policy result and summaries for request ${requestId} (task ${taskId}).`,
    );
  }

  private getStateFromPolicyDecision(
    decision: PolicyDecision,
  ): RequestLifecycleState {
    switch (decision.requiredApprovalPath) {
      case "manager_only":
        return "awaiting_manager_approval";
      case "manager_and_director":
        return "awaiting_manager_approval";
      default:
        return "policy_validated";
    }
  }

  private buildPolicyHistoryNote(decision: PolicyDecision): string {
    switch (decision.requiredApprovalPath) {
      case "manager_only":
        return "Policy decision recorded; awaiting manager approval.";
      case "manager_and_director":
        return "Policy decision recorded; awaiting manager then director approvals.";
      default:
        return "Policy decision recorded; no approvals required.";
    }
  }

  private async notifyApproversIfRequired(
    record: SummaryStoreRecord,
    policyDecision: PolicyDecision,
    summaryForApprover: string,
  ): Promise<void> {
    const rolesToNotify: ApproverRole[] = [];
    if (policyDecision.requiredApprovalPath === "manager_only") {
      rolesToNotify.push("manager");
    } else if (policyDecision.requiredApprovalPath === "manager_and_director") {
      rolesToNotify.push("manager");
    }

    if (!rolesToNotify.length) {
      return;
    }

    const notifiedRoles = this.getNotifiedRoles(record.status);
    for (const role of rolesToNotify) {
      if (notifiedRoles.has(role)) {
        continue;
      }

      const payload: NotifyApprovalRequiredPayload = {
        intent: "notify_approval_required",
        requestId: record.status.requestId,
        role,
        summaryForApprover:
          summaryForApprover ||
          `Awaiting ${role} approval for ${record.status.requestId}.`,
        statusRecord: record.status,
        financeRequest: record.financeRequest
          ? {
              directorate: record.financeRequest.directorate,
              serviceName: record.financeRequest.serviceName,
              amountExclVAT: record.financeRequest.amountExclVAT,
              descriptionOfSpend: record.financeRequest.descriptionOfSpend,
            }
          : undefined,
        policyDecision: record.policyDecision,
      };

      await this.sendApproverNotification(payload);
      notifiedRoles.add(role);
    }

    this.persistNotifiedRoles(record.status, notifiedRoles);
  }

  private async sendApproverNotification(
    payload: NotifyApprovalRequiredPayload,
  ): Promise<void> {
    try {
      const client = await this.getApproverClient();
      const metadata: ApproverMetadataEnvelope = {
        approverPayload: payload,
      };
      const message: Message = {
        kind: "message",
        role: "user",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text: `Please queue request ${payload.requestId} for ${payload.role} approval.`,
          },
        ],
        metadata,
      };

      const params: MessageSendParams = {
        message,
        configuration: {
          blocking: true,
        },
      };

      const response: SendMessageResponse = await client.sendMessage(params);
      if ("error" in response) {
        const rpcError = response as JSONRPCErrorResponse;
        logError(
          "Finance Approver Agent JSON-RPC error",
          rpcError.error?.code,
          rpcError.error?.message,
        );
      } else {
        logInfo(
          `Notified Finance Approver Agent about ${payload.role} work item for ${payload.requestId}.`,
        );
      }
    } catch (err) {
      logError("Failed to notify Finance Approver Agent", err);
    }
  }

  private getNotifiedRoles(status: StatusRecord): Set<ApproverRole> {
    const notified =
      (status.metadata?.notifiedApproverRoles as ApproverRole[] | undefined) ??
      [];
    return new Set(notified);
  }

  private persistNotifiedRoles(
    status: StatusRecord,
    roles: Set<ApproverRole>,
  ): void {
    status.metadata = {
      ...(status.metadata ?? {}),
      notifiedApproverRoles: Array.from(roles),
    };
  }

  private async notifyDirectorIfNeeded(
    record: SummaryStoreRecord,
    summaryForApprover: string,
  ): Promise<void> {
    if (
      record.policyDecision?.requiredApprovalPath !== "manager_and_director"
    ) {
      return;
    }

    const notifiedRoles = this.getNotifiedRoles(record.status);
    if (notifiedRoles.has("director")) {
      return;
    }

    const payload: NotifyApprovalRequiredPayload = {
      intent: "notify_approval_required",
      requestId: record.status.requestId,
      role: "director",
      summaryForApprover:
        summaryForApprover ||
        `Awaiting director approval for ${record.status.requestId}.`,
      statusRecord: record.status,
      financeRequest: record.financeRequest
        ? {
            directorate: record.financeRequest.directorate,
            serviceName: record.financeRequest.serviceName,
            amountExclVAT: record.financeRequest.amountExclVAT,
            descriptionOfSpend: record.financeRequest.descriptionOfSpend,
          }
        : undefined,
      policyDecision: record.policyDecision,
    };

    await this.sendApproverNotification(payload);
    notifiedRoles.add("director");
    this.persistNotifiedRoles(record.status, notifiedRoles);
  }

  private async handleApproverDecision(
    payload: ApproverDecisionPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const now = getCurrentTimestamp();
    const { requestId, approverRole, outcome, comment, statusRecord } = payload;

    let record = this.store.get(requestId);
    if (!record) {
      logError(
        `No existing SummaryStoreRecord for request ${requestId} when processing approver_decision.`,
      );
      record = {
        status: statusRecord ?? initStatusRecord(requestId),
      };
    }

    const requiresDirector =
      record.policyDecision?.requiredApprovalPath === "manager_and_director";

    let nextState = record.status.currentState;
    if (outcome === "approved") {
      if (approverRole === "manager" && requiresDirector) {
        nextState = "awaiting_director_approval";
      } else {
        nextState = "approved";
      }
    } else if (outcome === "rejected") {
      nextState = "rejected";
    }

    let historyNote =
      outcome === "more_info_requested"
        ? comment
          ? `${approverRole} requested more information: ${comment}`
          : `${approverRole} requested more information.`
        : comment ??
          `Decision recorded by ${approverRole}: ${outcome.toUpperCase()}`;
    if (
      outcome === "approved" &&
      approverRole === "manager" &&
      requiresDirector
    ) {
      historyNote = `${historyNote ?? "Manager approved."} Awaiting director approval next.`;
    }

    record.status = {
      ...record.status,
      currentState: nextState,
      updatedAt: now,
      updatedBy: "summary",
      history: [
        ...record.status.history,
        {
          state: nextState,
          updatedAt: now,
          updatedBy: "summary",
          note: historyNote,
        },
      ],
    };

    const summaries = await generateSummaries(record);
    record.status.summaryForRequester = summaries.summaryForRequester;
    record.status.summaryForApprover = summaries.summaryForApprover;
    this.store.set(requestId, record);

    if (outcome === "approved" && approverRole === "manager") {
      await this.notifyDirectorIfNeeded(record, summaries.summaryForApprover);
    }

    const task: Task = existingTask ?? {
      kind: "task",
      id: taskId,
      contextId,
      status: {
        state: "submitted",
        timestamp: now,
      },
      history: [userMessage],
      metadata: {},
    };

    task.metadata = {
      ...(task.metadata ?? {}),
      statusRecord: record.status,
    };

    eventBus.publish(task);

    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: summaries.summaryForRequester }],
      taskId,
      contextId,
    };

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        message: agentMessage,
        timestamp: now,
      },
      final: true,
    };

    eventBus.publish(statusUpdate);
    eventBus.finished();

    logInfo(
      `Recorded approver decision '${outcome}' from ${approverRole} for request ${requestId}.`,
    );
  }

  private async handleStatusQuery(
    payload: StatusQueryPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const now = getCurrentTimestamp();
    const { requestId, audience } = payload;

    let record = this.store.get(requestId);
    if (!record) {
      logError(`Status query for unknown requestId ${requestId}.`);

      const agentMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text:
              "I could not find that request. Please check the reference ID and try again.",
          },
        ],
        taskId,
        contextId,
      };

      const failedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "failed",
          message: agentMessage,
          timestamp: now,
        },
        final: true,
      };
      eventBus.publish(failedUpdate);
      eventBus.finished();
      return;
    }

    if (
      !record.status.summaryForRequester ||
      !record.status.summaryForApprover
    ) {
      const summaries = await generateSummaries(record);
      record.status.summaryForRequester = summaries.summaryForRequester;
      record.status.summaryForApprover = summaries.summaryForApprover;
      this.store.set(requestId, record);
    }

    const summaryText =
      audience === "approver"
        ? record.status.summaryForApprover ??
          "Status available but no approver summary yet."
        : record.status.summaryForRequester ??
          "Status available but no requester summary yet.";

    const task: Task = existingTask ?? {
      kind: "task",
      id: taskId,
      contextId,
      status: {
        state: "submitted",
        timestamp: now,
      },
      history: [userMessage],
      metadata: {},
    };

    task.metadata = {
      ...(task.metadata ?? {}),
      statusRecord: record.status,
    };

    eventBus.publish(task);

    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: summaryText }],
      taskId,
      contextId,
    };

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        message: agentMessage,
        timestamp: now,
      },
      final: true,
    };

    eventBus.publish(statusUpdate);
    eventBus.finished();

    logInfo(`Answered status_query for ${requestId} (audience=${audience}).`);
  }
}
