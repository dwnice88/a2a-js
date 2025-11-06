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

import {
  REQUIRED_FIELDS,
  generateRequestId,
} from "./types.js";
import type {
  FinanceIntakeProgress,
  FinanceIntakeMetadata,
  PlannerOutput,
} from "./types.js";
import type {
  FinanceRequest,
  PolicyDecision,
} from "../../finance/index.js";
import { runFinanceIntakePlanner } from "./planner.js";

const FINANCE_INTAKE_DEBUG =
  process.env.FINANCE_INTAKE_DEBUG === "1" ||
  process.env.FINANCE_INTAKE_DEBUG === "true";
const FINANCE_POLICY_AGENT_URL =
  process.env.FINANCE_POLICY_AGENT_URL ?? "http://localhost:41002/";
let policyClientPromise: Promise<A2AClient> | null = null;

async function getPolicyClient(): Promise<A2AClient> {
  if (!policyClientPromise) {
    const baseUrl =
      process.env.FINANCE_POLICY_AGENT_URL ?? "http://localhost:41002";
    const cardUrl = `${baseUrl}/${AGENT_CARD_PATH}`;

    policyClientPromise = A2AClient.fromCardUrl(cardUrl);

    logInfo(
      `Initialised Finance Policy A2A client from Agent Card at ${cardUrl}`,
    );
  }

  return policyClientPromise;
}

export function logInfo(message: string, ...args: unknown[]) {
  console.log("[FinanceIntake]", message, ...args);
}

export function logDebug(message: string, ...args: unknown[]) {
  if (FINANCE_INTAKE_DEBUG) {
    console.debug("[FinanceIntake][debug]", message, ...args);
  }
}

export function logError(message: string, ...args: unknown[]) {
  console.error("[FinanceIntake][error]", message, ...args);
}

function initIntakeProgress(): FinanceIntakeProgress {
  return {
    requestId: undefined,
    partialRequest: {},
    completedFields: [],
    missingFields: [...REQUIRED_FIELDS],
    lastQuestion: undefined,
  };
}

function getOrInitMetadata(task?: Task): FinanceIntakeMetadata {
  const existing = (task?.metadata as FinanceIntakeMetadata | undefined)?.intake;
  const intake = existing ?? initIntakeProgress();
  return { intake };
}

function withUpdatedMetadata(
  task: Task,
  metadata: FinanceIntakeMetadata,
): Task {
  return {
    ...task,
    metadata: {
      ...(task.metadata ?? {}),
      ...metadata,
    },
  };
}

function createInitialTask(
  taskId: string,
  contextId: string,
  userMessage: Message,
): Task {
  const metadata = getOrInitMetadata(undefined);
  const now = getCurrentTimestamp();

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

function buildFinanceRequestForPolicy(
  intake: FinanceIntakeProgress,
): FinanceRequest | null {
  if (!intake.requestId) {
    logDebug(
      "Skipping policy call because requestId is not yet set on intake progress",
    );
    return null;
  }

  const candidate = {
    ...intake.partialRequest,
    requestId: intake.requestId,
  } as FinanceRequest;

  return candidate;
}

function getUserText(message: Message): string {
  const textPart = message.parts.find((part) => part.kind === "text");
  return textPart?.text?.trim() ?? "";
}

function isShortcutMessage(userText: string): boolean {
  return userText.toLowerCase().startsWith("/esaf-shortcut");
}

function createDemoFinanceRequest(requestId: string): FinanceRequest {
  return {
    requestId,
    directorate: "Adults' Care & Support",
    serviceName: "Adult Social Care",
    costCentreCode: "AC1234",
    typeOfSpend: "services",
    amountExclVAT: {
      amount: 10000,
      currency: "GBP",
    },
    ringFencedFunding: "No",
    isBusinessCritical: "Yes",
    isStatutory: "No",
    canBeDeferred: "No",
    hasContractInPlace: "Yes",
    descriptionOfSpend: "Emergency accommodation for a vulnerable resident.",
    justification:
      "Accommodation is required to prevent immediate harm and avoid higher long-term costs.",
    headOfFinance: "Jane Smith",
    executiveTeamOrDelegate: "Executive Director – People",
  };
}

export class FinanceIntakeAgentExecutor implements AgentExecutor {
  public cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    // No-op for now – intake tasks are short-lived.
  };

  public async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, task: existingTask, taskId, contextId } =
      requestContext;

    logInfo(
      `Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`,
    );

    let task: Task;

    if (!existingTask) {
      task = createInitialTask(taskId, contextId, userMessage);
      eventBus.publish(task);
      logInfo(`Created new intake task ${taskId}`);
    } else {
      const history = existingTask.history ? [...existingTask.history] : [];
      if (!history.find((m) => m.messageId === userMessage.messageId)) {
        history.push(userMessage);
      }
      task = { ...existingTask, history };
    }

    const userText = getUserText(userMessage);
    if (!userText) {
      const agentMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text: "I didn't catch any details there. Could you share more about this spend request?",
          },
        ],
        taskId,
        contextId,
      };

      const statusUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId,
        contextId,
        status: {
          state: "input-required",
          message: agentMessage,
          timestamp: getCurrentTimestamp(),
        },
        final: true,
      };

      eventBus.publish(statusUpdate);
      return;
    }

    const metadata = getOrInitMetadata(task);
    const intake = metadata.intake;

    const shortcut = isShortcutMessage(userText);
    const cleanUserText = shortcut
      ? userText.replace(/^\/esaf-shortcut\s*/i, "")
      : userText;

    // If we're in shortcut mode but the user hasn't provided any details,
    // create a fully-populated demo request and complete the task without
    // calling OpenAI.
    if (shortcut && cleanUserText.trim().length === 0) {
      const requestId = intake.requestId ?? generateRequestId();
      intake.requestId = requestId;

      const demoRequest = createDemoFinanceRequest(requestId);

      intake.partialRequest = demoRequest;
      intake.completedFields = [...REQUIRED_FIELDS];
      intake.missingFields = [];
      intake.lastQuestion = undefined;

      const updatedMetadata: FinanceIntakeMetadata = { intake };
      task = withUpdatedMetadata(task, updatedMetadata);
      eventBus.publish(task);

      const replyText =
        `Shortcut demo mode: I’ve created a sample Essential Spend Authorisation request ` +
        `with reference ID ${requestId}. We’ll now run it through the finance policy checks.`;

      const agentMessage: Message = {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [{ kind: "text", text: replyText }],
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
      logInfo(
        `Task ${taskId} completed via demo shortcut with ID ${requestId}`,
      );

      return;
    }

    const plannerResult: PlannerOutput = await runFinanceIntakePlanner({
      userText: cleanUserText,
      partialRequest: intake.partialRequest,
      missingFields: intake.missingFields,
      completedFields: intake.completedFields,
      lastQuestion: intake.lastQuestion,
      mode: shortcut ? "shortcut" : "normal",
    });

    intake.partialRequest = {
      ...intake.partialRequest,
      ...plannerResult.updatedRequest,
    };
    intake.completedFields = plannerResult.completedFields;
    intake.missingFields = plannerResult.missingFields;
    intake.lastQuestion = plannerResult.nextQuestion ?? undefined;

    if (plannerResult.isComplete && !intake.requestId) {
      intake.requestId = generateRequestId();
    }

    const updatedMetadata: FinanceIntakeMetadata = { intake };
    task = withUpdatedMetadata(task, updatedMetadata);
    eventBus.publish(task);

    let replyText: string;
    let state: "input-required" | "completed";

    if (!plannerResult.isComplete) {
      replyText =
        plannerResult.nextQuestion ??
        "What is the next key detail about this spend you can share?";
      state = "input-required";
    } else {
      const base = `I’ve captured your Essential Spend Authorisation request with reference ID ${intake.requestId}. We’ll now run it through the finance policy checks.`;
      replyText = shortcut
        ? `Shortcut mode: I’ve parsed your full description and ${base}`
        : `Thanks – ${base}`;
      state = "completed";
    }

    const agentMessage: Message = {
      kind: "message",
      role: "agent",
      messageId: uuidv4(),
      parts: [{ kind: "text", text: replyText }],
      taskId,
      contextId,
    };

    const statusUpdate: TaskStatusUpdateEvent = {
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

    eventBus.publish(statusUpdate);
    logDebug(
      `Turn summary for task ${taskId}: mode=${shortcut ? "shortcut" : "normal"}, isComplete=${plannerResult.isComplete}, missing=${plannerResult.missingFields.length}`,
    );
    logInfo(
      `Task ${taskId} finished turn with state: ${state}`,
    );

    if (plannerResult.isComplete && intake.requestId) {
      const financeRequest = buildFinanceRequestForPolicy(intake);
      if (financeRequest) {
        logInfo(
          `Calling Finance Policy Agent for request ${intake.requestId} (task ${taskId})`,
        );
        const policyDecision = await this.callPolicyAgent(financeRequest);

        if (policyDecision) {
          const metadataWithPolicy: FinanceIntakeMetadata = {
            ...updatedMetadata,
            policyDecision,
          };
          task = withUpdatedMetadata(task, metadataWithPolicy);
        } else {
          logError(
            `Policy decision not available for request ${intake.requestId}`,
          );
        }
      }
    }
  }

  private async callPolicyAgent(
    financeRequest: FinanceRequest,
  ): Promise<PolicyDecision | null> {
    try {
      logDebug(
        "Preparing to call Finance Policy Agent at",
        FINANCE_POLICY_AGENT_URL,
      );
      const client = await getPolicyClient();

      const message: Message = {
        kind: "message",
        role: "user",
        messageId: uuidv4(),
        parts: [
          {
            kind: "text",
            text:
              "Please evaluate this ESAF request against policy thresholds and disallowed spend types.",
          },
        ],
        metadata: {
          financeRequest,
        },
      };

      const params: MessageSendParams = {
        message,
        configuration: {
          blocking: true,
        },
      };

      const rpcResponse: SendMessageResponse = await client.sendMessage(
        params,
      );

      if ("error" in rpcResponse) {
        const error = rpcResponse as JSONRPCErrorResponse;
        logError(
          "Policy agent JSON-RPC error",
          error.error?.code,
          error.error?.message,
        );
        return null;
      }

      const result = rpcResponse.result;

      if (!result || result.kind !== "task") {
        logError("Policy agent did not return a Task result", result);
        return null;
      }

      const taskResult = result as Task;
      const metadata = taskResult.metadata as
        | { policyDecision?: PolicyDecision }
        | undefined;

      if (!metadata?.policyDecision) {
        logError(
          "Policy agent Task result is missing policyDecision in metadata",
        );
        return null;
      }

      logDebug(
        "Received policyDecision from Finance Policy Agent",
        metadata.policyDecision,
      );

      return metadata.policyDecision;
    } catch (err) {
      logError("Failed to call policy agent", err);
      return null;
    }
  }
}
