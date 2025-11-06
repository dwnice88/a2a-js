import { v4 as uuidv4 } from "uuid";

import { A2AClient } from "../../client/index.js";
import { AGENT_CARD_PATH } from "../../constants.js";

import type {
  Task,
  TaskStatusUpdateEvent,
  Message,
} from "../../index.js";

import type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "../../server/index.js";
import { getCurrentTimestamp } from "../../server/utils.js";

import type {
  MessageSendParams,
  SendMessageResponse,
  JSONRPCErrorResponse,
} from "../../types.js";
import type { Money, StatusRecord } from "../../finance/index.js";

import type {
  ApproverMetadataEnvelope,
  ApproverPayload,
  CreateApprovalTaskPayload,
  NotifyApprovalRequiredPayload,
  ListPendingPayload,
  SubmitDecisionPayload,
  ApproverInboxItem,
  ApproverRole,
} from "./types.js";
import type { SummaryMetadataEnvelope } from "../finance-summary-agent/types.js";

const DEFAULT_SUMMARY_AGENT_URL =
  process.env.FINANCE_SUMMARY_AGENT_URL ?? "http://localhost:41003";
const NORMALISED_SUMMARY_AGENT_URL = DEFAULT_SUMMARY_AGENT_URL.replace(/\/+$/, "");

export function logInfo(message: string, ...args: unknown[]) {
  console.log("[FinanceApprover]", message, ...args);
}

export function logError(message: string, ...args: unknown[]) {
  console.error("[FinanceApprover][error]", message, ...args);
}

export class FinanceApproverAgentExecutor implements AgentExecutor {
  private readonly inbox = new Map<ApproverRole, ApproverInboxItem[]>();
  private summaryClientPromise: Promise<A2AClient> | null = null;

  public async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, task: existingTask, taskId, contextId } =
      requestContext;

    const envelope = (userMessage.metadata ?? {}) as ApproverMetadataEnvelope;
    const payload = envelope.approverPayload as ApproverPayload | undefined;

    if (!payload) {
      logError(
        `Task ${taskId} is missing metadata.approverPayload; cannot proceed.`,
      );
      this.publishTaskStatus(
        taskId,
        contextId,
        eventBus,
        "failed",
        "Finance Approver Agent requires metadata.approverPayload to run.",
      );
      return;
    }

    switch (payload.intent) {
      case "notify_approval_required":
        await this.handleNotifyApprovalRequired(
          payload as NotifyApprovalRequiredPayload,
          existingTask,
          taskId,
          contextId,
          userMessage,
          eventBus,
        );
        return;
      case "create_approval_task":
        await this.handleCreateApprovalTask(
          payload as CreateApprovalTaskPayload,
          existingTask,
          taskId,
          contextId,
          userMessage,
          eventBus,
        );
        return;
      case "list_pending":
        await this.handleListPending(
          payload as ListPendingPayload,
          existingTask,
          taskId,
          contextId,
          userMessage,
          eventBus,
        );
        return;
      case "submit_decision":
        await this.handleSubmitDecision(
          payload as SubmitDecisionPayload,
          existingTask,
          taskId,
          contextId,
          userMessage,
          eventBus,
        );
        return;
      default:
        logError(`Unsupported approver intent '${payload.intent}'.`);
        this.publishTaskStatus(
          taskId,
          contextId,
          eventBus,
          "failed",
          `Unsupported intent '${payload.intent}'.`,
        );
    }
  }

  public async cancelTask(
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId: `finance-approver-${taskId}`,
      status: {
        state: "canceled",
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };
    eventBus.publish(update);
    eventBus.finished();
  }

  private async handleNotifyApprovalRequired(
    payload: NotifyApprovalRequiredPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const {
      requestId,
      role,
      summaryForApprover,
      statusRecord,
      financeRequest,
      policyDecision,
    } = payload;

    if (!requestId || !role || !statusRecord) {
      logError(
        "notify_approval_required payload missing required fields",
        payload,
      );
      this.publishTaskStatus(
        taskId,
        contextId,
        eventBus,
        "failed",
        "Request ID, role, and statusRecord are required for notify_approval_required.",
      );
      return;
    }

    const now = getCurrentTimestamp();
    const summarisedText =
      summaryForApprover.trim() ||
      statusRecord.summaryForApprover ||
      `Awaiting ${role} approval for ${requestId}.`;

    const inboxItem: ApproverInboxItem = {
      requestId,
      approverRole: role,
      createdAt: now,
      summaryForApprover: summarisedText,
      financeRequest,
      policyDecision: policyDecision ?? statusRecord.policyDecision,
      statusSnapshot: statusRecord,
    };

    const existingItems = this.getInbox(role).filter(
      (item) => item.requestId !== requestId,
    );
    existingItems.push(inboxItem);
    this.inbox.set(role, existingItems);

    const task =
      existingTask ?? this.createInitialTask(taskId, contextId, userMessage);
    task.metadata = {
      ...(task.metadata ?? {}),
      pendingItems: existingItems,
    };

    eventBus.publish(task);

    const confirmation = `Queued ${requestId} for ${role} approval.`;
    this.publishTaskStatus(
      taskId,
      contextId,
      eventBus,
      "completed",
      confirmation,
    );

    logInfo(
      `Notified ${role} approval required for ${requestId}; inbox now has ${existingItems.length} item(s).`,
    );
  }

  private async handleCreateApprovalTask(
    payload: CreateApprovalTaskPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const {
      requestId,
      approverRole,
      financeRequest,
      policyDecision,
      statusRecord,
      summaryForApprover,
    } = payload;

    if (
      !requestId ||
      !approverRole ||
      !financeRequest ||
      !policyDecision ||
      !statusRecord ||
      !summaryForApprover
    ) {
      logError("create_approval_task payload missing required fields", payload);
      this.publishTaskStatus(
        taskId,
        contextId,
        eventBus,
        "failed",
        "Required fields missing for create_approval_task.",
      );
      return;
    }

    const now = getCurrentTimestamp();
    const inboxItem: ApproverInboxItem = {
      requestId,
      approverRole,
      createdAt: now,
      summaryForApprover,
      financeRequest: {
        directorate: financeRequest.directorate,
        serviceName: financeRequest.serviceName,
        amountExclVAT: financeRequest.amountExclVAT,
        descriptionOfSpend: financeRequest.descriptionOfSpend,
      },
      policyDecision,
      statusSnapshot: statusRecord,
    };

    const items = this.getInbox(approverRole);
    items.push(inboxItem);
    this.inbox.set(approverRole, items);

    const task = existingTask ?? this.createInitialTask(taskId, contextId, userMessage);
    task.metadata = {
      ...(task.metadata ?? {}),
      pendingItems: items,
    };

    eventBus.publish(task);

    const confirmation = `I've added request ${requestId} to the ${approverRole} approval inbox.`;
    this.publishTaskStatus(taskId, contextId, eventBus, "completed", confirmation);
    logInfo(
      `Added ${requestId} to ${approverRole} inbox (total ${items.length} item(s)).`,
    );
  }

  private async handleListPending(
    payload: ListPendingPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { role } = payload;
    if (!role) {
      logError("list_pending payload missing role", payload);
      this.publishTaskStatus(
        taskId,
        contextId,
        eventBus,
        "failed",
        "Role is required to list pending approvals.",
      );
      return;
    }

    const items = this.getInbox(role);
    const task = existingTask ?? this.createInitialTask(taskId, contextId, userMessage);
    task.metadata = {
      ...(task.metadata ?? {}),
      pendingItems: items,
    };

    eventBus.publish(task);

    const summaryText = this.buildPendingSummary(role, items);
    this.publishTaskStatus(taskId, contextId, eventBus, "completed", summaryText);
  }

  private async handleSubmitDecision(
    payload: SubmitDecisionPayload,
    existingTask: Task | undefined,
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { requestId, role, outcome, comment } = payload;

    if (!requestId || !role || !outcome) {
      logError("submit_decision payload missing required fields", payload);
      this.publishTaskStatus(
        taskId,
        contextId,
        eventBus,
        "failed",
        "Request ID, role, and outcome are required to submit a decision.",
      );
      return;
    }

    const items = this.getInbox(role);
    const itemIndex = items.findIndex((item) => item.requestId === requestId);

    if (itemIndex === -1) {
      const message = `No pending request ${requestId} found in the ${role} inbox.`;
      logError(message);
      this.publishTaskStatus(taskId, contextId, eventBus, "failed", message);
      return;
    }

    const inboxItem = items[itemIndex];
    const updatedStatus = await this.forwardDecisionToSummary(
      payload,
      inboxItem,
    );

    if (!updatedStatus) {
      const errorMessage =
        "Unable to forward decision to Finance Summary Agent. Please try again.";
      this.publishTaskStatus(taskId, contextId, eventBus, "failed", errorMessage);
      return;
    }

    inboxItem.statusSnapshot = updatedStatus;

    if (outcome === "approved" || outcome === "rejected") {
      items.splice(itemIndex, 1);
    } else {
      items[itemIndex] = inboxItem;
    }

    this.inbox.set(role, items);

    const task = existingTask ?? this.createInitialTask(taskId, contextId, userMessage);
    task.metadata = {
      ...(task.metadata ?? {}),
      pendingItems: items,
    };
    eventBus.publish(task);

    const confirmation = this.buildDecisionConfirmationMessage(
      role,
      requestId,
      outcome,
    );
    this.publishTaskStatus(taskId, contextId, eventBus, "completed", confirmation);

    logInfo(
      `Recorded ${role} decision '${outcome}' for ${requestId}. Remaining inbox size: ${items.length}.`,
    );
  }

  private async forwardDecisionToSummary(
    payload: SubmitDecisionPayload,
    inboxItem: ApproverInboxItem,
  ): Promise<StatusRecord | null> {
    try {
      const client = await this.getSummaryClient();
      const metadata: SummaryMetadataEnvelope = {
        summaryPayload: {
          intent: "approver_decision",
          requestId: payload.requestId,
          approverRole: payload.role,
          outcome: payload.outcome,
          comment: payload.comment,
          statusRecord: inboxItem.statusSnapshot,
        },
      };

      const message: Message = {
        kind: "message",
        role: "user",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text: "Record this approver decision in the ESAF status record.",
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
          "Finance Summary Agent JSON-RPC error",
          rpcError.error?.code,
          rpcError.error?.message,
        );
        return null;
      }

      const result = response.result;
      if (!result || result.kind !== "task") {
        logError("Finance Summary Agent returned unexpected payload", result);
        return null;
      }

      const metadataResult = result.metadata as
        | { statusRecord?: StatusRecord }
        | undefined;

      return metadataResult?.statusRecord ?? null;
    } catch (err) {
      logError("Failed to forward approver decision to Finance Summary Agent", err);
      return null;
    }
  }

  private createInitialTask(
    taskId: string,
    contextId: string,
    userMessage: Message,
  ): Task {
    return {
      kind: "task",
      id: taskId,
      contextId,
      status: {
        state: "submitted",
        timestamp: getCurrentTimestamp(),
      },
      history: [userMessage],
      metadata: {},
    };
  }

  private getInbox(role: ApproverRole): ApproverInboxItem[] {
    return this.inbox.get(role) ?? [];
  }

  private buildPendingSummary(
    role: ApproverRole,
    items: ApproverInboxItem[],
  ): string {
    if (items.length === 0) {
      return `You have no pending requests for ${role} approval.`;
    }

    const header = `You have ${items.length} pending request${
      items.length === 1 ? "" : "s"
    }:`;
    const lines = items.map((item, index) => {
      const serviceName = item.financeRequest?.serviceName ?? "Unknown service";
      const amount = item.financeRequest?.amountExclVAT
        ? formatMoney(item.financeRequest.amountExclVAT)
        : "Amount not provided";
      const summaryText = truncateText(item.summaryForApprover ?? "");
      return `${index + 1}. ${item.requestId} – ${serviceName} – ${amount} – ${summaryText}`;
    });

    return [header, ...lines].join("\n");
  }

  private buildDecisionConfirmationMessage(
    role: ApproverRole,
    requestId: string,
    outcome: SubmitDecisionPayload["outcome"],
  ): string {
    switch (outcome) {
      case "approved":
        return `Recorded ${role} approval for ${requestId}.`;
      case "rejected":
        return `Recorded ${role} rejection for ${requestId}.`;
      case "more_info_requested":
      default:
        return `Recorded ${role} request for more information on ${requestId}.`;
    }
  }

  private publishTaskStatus(
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus,
    state: TaskStatusUpdateEvent["status"]["state"],
    text: string,
  ): void {
    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text }],
      taskId,
      contextId,
    };

    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state,
        message: agentMessage,
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };

    eventBus.publish(update);
    eventBus.finished();
  }

  private async getSummaryClient(): Promise<A2AClient> {
    if (!this.summaryClientPromise) {
      const cardUrl = `${NORMALISED_SUMMARY_AGENT_URL}/${AGENT_CARD_PATH}`;
      this.summaryClientPromise = A2AClient.fromCardUrl(cardUrl);
      logInfo(
        `Initialised Finance Summary Agent client using Agent Card at ${cardUrl}.`,
      );
    }

    return this.summaryClientPromise;
  }
}

function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: money.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(money.amount);
  } catch (err) {
    logError("Failed to format money", err);
    return `${money.currency} ${money.amount}`;
  }
}

function truncateText(text: string, maxLength = 120): string {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
