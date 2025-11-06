import { v4 as uuidv4 } from "uuid";

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
  SummaryMetadataEnvelope,
  PolicyResultPayload,
  ApproverDecisionPayload,
  StatusQueryPayload,
  SummaryStoreRecord,
} from "./types.js";
import { generateSummaries } from "./summariser.js";
import type { StatusRecord } from "../../finance/index.js";

const FINANCE_SUMMARY_DEBUG =
  process.env.FINANCE_SUMMARY_DEBUG === "1" ||
  process.env.FINANCE_SUMMARY_DEBUG === "true";

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

    if (payload.intent === "policy_result") {
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

    record.status = {
      ...record.status,
      currentState: "policy_validated",
      updatedAt: now,
      updatedBy: "summary",
      policyDecision,
      history: [
        ...record.status.history,
        {
          state: "policy_validated",
          updatedAt: now,
          updatedBy: "summary",
          note: "Policy decision received.",
        },
      ],
    };

    const summaries = await generateSummaries(record);
    record.status.summaryForRequester = summaries.summaryForRequester;
    record.status.summaryForApprover = summaries.summaryForApprover;

    this.store.set(requestId, record);

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

    let nextState = record.status.currentState;
    if (outcome === "approved") {
      nextState = "approved";
    } else if (outcome === "rejected") {
      nextState = "rejected";
    }

    const historyNote =
      outcome === "more_info_requested"
        ? comment
          ? `${approverRole} requested more information: ${comment}`
          : `${approverRole} requested more information.`
        : comment ??
          `Decision recorded by ${approverRole}: ${outcome.toUpperCase()}`;

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
