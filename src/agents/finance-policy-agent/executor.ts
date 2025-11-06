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

import {
  FinanceRequest,
  PolicyDecision,
  PolicyDecisionState,
} from "../../finance/index.js";
import { financePolicyConfig } from "../../finance/policyConfig.js";

const FINANCE_POLICY_DEBUG =
  process.env.FINANCE_POLICY_DEBUG === "1" ||
  process.env.FINANCE_POLICY_DEBUG === "true";

export function logInfo(message: string, ...args: unknown[]) {
  console.log("[FinancePolicy]", message, ...args);
}

export function logDebug(message: string, ...args: unknown[]) {
  if (FINANCE_POLICY_DEBUG) {
    console.debug("[FinancePolicy][debug]", message, ...args);
  }
}

export function logError(message: string, ...args: unknown[]) {
  console.error("[FinancePolicy][error]", message, ...args);
}

function evaluatePolicy(request: FinanceRequest): PolicyDecision {
  const { managerOnlyMax, managerAndDirectorMin, disallowedSpendTypes } =
    financePolicyConfig;

  const reasons: PolicyDecision["reasons"] = [];
  let decisionState: PolicyDecisionState;
  let requiredApprovalPath: PolicyDecision["requiredApprovalPath"];

  // 1. Disallowed type check
  if (disallowedSpendTypes.includes(request.typeOfSpend)) {
    decisionState = "auto_rejected";
    requiredApprovalPath = "none";
    reasons.push({
      code: "disallowed_spend_type",
      message: `Type of spend '${request.typeOfSpend}' is not permitted under current policy.`,
    });
    return { decisionState, requiredApprovalPath, reasons };
  }

  const amount = request.amountExclVAT.amount;

  // 2. Threshold checks
  if (amount <= managerOnlyMax) {
    decisionState = "needs_manager_approval";
    requiredApprovalPath = "manager_only";
    reasons.push({
      code: "within_manager_threshold",
      message: `Amount £${amount.toLocaleString()} is within manager-only approval threshold.`,
    });
  } else if (amount >= managerAndDirectorMin) {
    decisionState = "needs_manager_and_director_approval";
    requiredApprovalPath = "manager_and_director";
    reasons.push({
      code: "requires_manager_and_director",
      message: `Amount £${amount.toLocaleString()} requires both manager and director approval.`,
    });
  } else {
    // Safety net; in practice thresholds should cover all values.
    decisionState = "needs_manager_approval";
    requiredApprovalPath = "manager_only";
    reasons.push({
      code: "default_path",
      message: "Fell back to manager approval by default.",
    });
  }

  return {
    decisionState,
    requiredApprovalPath,
    reasons,
  };
}

interface FinancePolicyMetadata {
  financeRequest: FinanceRequest;
  policyDecision?: PolicyDecision;
}

function createOrUpdateTask(
  existingTask: Task | undefined,
  taskId: string,
  contextId: string,
  userMessage: Message,
  metadata: FinancePolicyMetadata,
): Task {
  const now = getCurrentTimestamp();

  if (!existingTask) {
    return {
      kind: "task",
      id: taskId,
      contextId,
      status: {
        state: "submitted",
        timestamp: now,
      },
      history: [userMessage],
      metadata,
    };
  }

  const history = existingTask.history ? [...existingTask.history] : [];
  if (!history.find((m) => m.messageId === userMessage.messageId)) {
    history.push(userMessage);
  }

  return {
    ...existingTask,
    history,
    metadata: {
      ...(existingTask.metadata ?? {}),
      ...metadata,
    },
  };
}

export class FinancePolicyAgentExecutor implements AgentExecutor {
  private readonly taskContexts = new Map<string, string>();

  public async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, task: existingTask, taskId, contextId } =
      requestContext;

    this.taskContexts.set(taskId, contextId);

    logInfo(
      `Evaluating policy for task ${taskId} (context: ${contextId}, message: ${userMessage.messageId})`,
    );

    const fromTask = existingTask?.metadata as
      | FinancePolicyMetadata
      | undefined;
    const fromMessage = userMessage.metadata as
      | FinancePolicyMetadata
      | { financeRequest?: FinanceRequest }
      | undefined;

    const financeRequest =
      fromTask?.financeRequest ?? fromMessage?.financeRequest;

    if (!financeRequest) {
      logError(
        `No financeRequest found in metadata for task ${taskId}. Cannot evaluate policy.`,
      );

      const errorMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text: "Policy evaluation failed: financeRequest metadata is missing.",
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
          message: errorMessage,
          timestamp: getCurrentTimestamp(),
        },
        final: true,
      };

      eventBus.publish(failedUpdate);
      eventBus.finished();
      return;
    }

    if (!financeRequest.amountExclVAT || !financeRequest.typeOfSpend) {
      logError(
        `financeRequest for ${taskId} is missing amountExclVAT or typeOfSpend.`,
      );

      const errorMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text:
              "Policy evaluation failed: request must include amountExclVAT and typeOfSpend.",
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
          message: errorMessage,
          timestamp: getCurrentTimestamp(),
        },
        final: true,
      };

      eventBus.publish(failedUpdate);
      eventBus.finished();
      return;
    }

    const policyDecision = evaluatePolicy(financeRequest);

    logDebug(`Policy decision for ${taskId}:`, policyDecision);

    const metadata: FinancePolicyMetadata = {
      financeRequest,
      policyDecision,
    };

    const task = createOrUpdateTask(
      existingTask,
      taskId,
      contextId,
      userMessage,
      metadata,
    );

    eventBus.publish(task);

    const summaryLines: string[] = [];
    summaryLines.push(
      `Policy decision: ${policyDecision.decisionState} (${policyDecision.requiredApprovalPath})`,
    );
    for (const reason of policyDecision.reasons) {
      summaryLines.push(`- ${reason.message}`);
    }

    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: summaryLines.join("\n") }],
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
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };

    eventBus.publish(statusUpdate);
    eventBus.finished();

    logInfo(
      `Finished policy evaluation for task ${taskId} with state ${policyDecision.decisionState}.`,
    );
  }

  public cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    const contextId = this.taskContexts.get(taskId) ?? `policy-${taskId}`;

    logInfo(`Cancel requested for task ${taskId}, marking as canceled.`);
    const cancelledUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "canceled",
        timestamp: getCurrentTimestamp(),
      },
      final: true,
    };
    eventBus.publish(cancelledUpdate);
    eventBus.finished();
  };
}
