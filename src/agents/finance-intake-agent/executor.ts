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
  MessageSendParams,
  SendMessageResponse,
  JSONRPCErrorResponse,
} from "../../types.js";

import { REQUIRED_FIELDS, generateRequestId } from "./types.js";
import type {
  FinanceIntakeProgress,
  FinanceIntakeMetadata,
  PlannerOutput,
} from "./types.js";
import type {
  FinanceRequest,
  PolicyDecision,
  StatusRecord,
} from "../../finance/index.js";
import type { SummaryMetadataEnvelope } from "../finance-summary-agent/types.js";
import { runFinanceIntakePlanner } from "./planner.js";

const FINANCE_INTAKE_DEBUG =
  process.env.FINANCE_INTAKE_DEBUG === "1" ||
  process.env.FINANCE_INTAKE_DEBUG === "true";
const FINANCE_POLICY_AGENT_URL =
  process.env.FINANCE_POLICY_AGENT_URL ?? "http://localhost:41002/";
const FINANCE_SUMMARY_AGENT_URL =
  process.env.FINANCE_SUMMARY_AGENT_URL ?? "http://localhost:41003/";
let policyClientPromise: Promise<A2AClient> | null = null;
let summaryClientPromise: Promise<A2AClient> | null = null;

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

async function getSummaryClient(): Promise<A2AClient> {
  if (!summaryClientPromise) {
    const baseUrl =
      process.env.FINANCE_SUMMARY_AGENT_URL ?? "http://localhost:41003";
    const normalised = baseUrl.replace(/\/+$/, "");
    const cardUrl = `${normalised}/${AGENT_CARD_PATH}`;
    summaryClientPromise = A2AClient.fromCardUrl(cardUrl);
    logInfo(
      `Initialised Finance Summary A2A client from Agent Card at ${cardUrl}`,
    );
  }

  return summaryClientPromise;
}

export function logInfo(message: string, ...args: unknown[]) {
  console.log("[FinanceIntake]", message, ...args);
}

export function logDebug(message: string, ...args: unknown[]) {
  if (FINANCE_INTAKE_DEBUG) {
    console.debug("[FinanceIntake][debug]", message, ...args);
  }
}

function getAgentReplyText(message?: Message): string | undefined {
  if (!message?.parts) {
    return undefined;
  }

  const textPart = message.parts.find((part) => part.kind === "text");
  return textPart?.text;
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
  const existing = task?.metadata as FinanceIntakeMetadata | undefined;
  if (existing) {
    return {
      ...existing,
      intake: existing.intake ?? initIntakeProgress(),
    };
  }

  return { intake: initIntakeProgress() };
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

    const statusQueryRequestId = this.parseStatusQuery(
      cleanUserText,
      intake.requestId,
    );
    if (statusQueryRequestId) {
      await this.respondWithStatus(
        statusQueryRequestId,
        metadata,
        task,
        taskId,
        contextId,
        userMessage,
        eventBus,
      );
      return;
    }

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

      const updatedMetadata: FinanceIntakeMetadata = {
        ...metadata,
        intake,
      };
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

    const updatedMetadata: FinanceIntakeMetadata = {
      ...metadata,
      intake,
    };
    task = withUpdatedMetadata(task, updatedMetadata);
    eventBus.publish(task);

    let metadataSnapshot = updatedMetadata;
    let downstreamSummaryText: string | null = null;

    if (plannerResult.isComplete && intake.requestId) {
      const financeRequest = buildFinanceRequestForPolicy(intake);
      if (financeRequest) {
        logInfo(
          `Calling downstream agents for request ${intake.requestId} (task ${taskId})`,
        );
        const downstreamResult = await this.processCompletedRequest(
          financeRequest,
          metadataSnapshot,
          task,
          eventBus,
        );
        if (downstreamResult) {
          task = downstreamResult.task;
          metadataSnapshot = downstreamResult.metadata;
          downstreamSummaryText =
            downstreamResult.summaryText ?? metadataSnapshot.statusText ?? null;
        }
      }
    }

    let replyText: string;
    let state: "input-required" | "completed";

    if (!plannerResult.isComplete) {
      replyText =
        plannerResult.nextQuestion ??
        "What is the next key detail about this spend you can share?";
      state = "input-required";
    } else {
      const base = `I’ve captured your Essential Spend Authorisation request with reference ID ${intake.requestId}. We’ll now run it through the finance policy checks.`;
      const intro = shortcut
        ? `Shortcut mode: I’ve parsed your full description and ${base}`
        : `Thanks – ${base}`;
      replyText = downstreamSummaryText
        ? `${intro}\n\n${downstreamSummaryText}`
        : intro;
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

  }

  private async processCompletedRequest(
    financeRequest: FinanceRequest,
    metadata: FinanceIntakeMetadata,
    task: Task,
    eventBus: ExecutionEventBus,
  ): Promise<{
    task: Task;
    metadata: FinanceIntakeMetadata;
    summaryText?: string;
  } | null> {
    let workingMetadata = { ...metadata };

    if (!workingMetadata.policyDecision) {
      const policyDecision = await this.callPolicyAgent(financeRequest);
      if (!policyDecision) {
        return null;
      }

      workingMetadata = {
        ...workingMetadata,
        policyDecision,
      };
      task = withUpdatedMetadata(task, workingMetadata);
      eventBus.publish(task);
    }

    if (workingMetadata.statusRecord) {
      return {
        task,
        metadata: workingMetadata,
        summaryText: workingMetadata.statusText,
      };
    }

    const summaryResult = await this.notifySummaryAgentOfPolicyResult(
      financeRequest,
      workingMetadata.policyDecision!,
    );

    if (summaryResult?.statusRecord) {
      workingMetadata = {
        ...workingMetadata,
        statusRecord: summaryResult.statusRecord,
        statusText:
          summaryResult.statusRecord.summaryForRequester ??
          summaryResult.summaryText,
      };
      task = withUpdatedMetadata(task, workingMetadata);
      eventBus.publish(task);
    }

    return {
      task,
      metadata: workingMetadata,
      summaryText:
        workingMetadata.statusText ?? summaryResult?.summaryText ?? undefined,
    };
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

  private async notifySummaryAgentOfPolicyResult(
    financeRequest: FinanceRequest,
    policyDecision: PolicyDecision,
  ): Promise<{ statusRecord?: StatusRecord; summaryText?: string } | null> {
    const metadata: SummaryMetadataEnvelope = {
      summaryPayload: {
        intent: "policy_decided",
        requestId: financeRequest.requestId,
        financeRequest,
        policyDecision,
      },
    };

    return this.sendSummaryAgentMessage(
      metadata,
      "Record this policy decision and update requester-facing status.",
    );
  }

  private async querySummaryAgentForStatus(
    requestId: string,
  ): Promise<{ statusRecord?: StatusRecord; summaryText?: string } | null> {
    const metadata: SummaryMetadataEnvelope = {
      summaryPayload: {
        intent: "status_query",
        requestId,
        audience: "requester",
      },
    };

    return this.sendSummaryAgentMessage(
      metadata,
      `Provide the latest requester-friendly ESAF status for ${requestId}.`,
    );
  }

  private async sendSummaryAgentMessage(
    metadata: SummaryMetadataEnvelope,
    instruction: string,
  ): Promise<{ statusRecord?: StatusRecord; summaryText?: string } | null> {
    try {
      const client = await getSummaryClient();
      const message: Message = {
        kind: "message",
        role: "user",
        messageId: uuidv4(),
        parts: [{ kind: "text", text: instruction }],
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
      if (!result) {
        return null;
      }

      if (result.kind === "task") {
        const statusRecord = (result.metadata as {
          statusRecord?: StatusRecord;
        })?.statusRecord;
        const summaryText =
          getAgentReplyText(result.status?.message) ??
          statusRecord?.summaryForRequester;
        return {
          statusRecord,
          summaryText: summaryText ?? undefined,
        };
      }

      if (result.kind === "message") {
        return {
          summaryText: getAgentReplyText(result),
        };
      }

      return null;
    } catch (err) {
      logError("Failed to call Finance Summary Agent", err);
      return null;
    }
  }

  private parseStatusQuery(
    userText: string,
    knownRequestId?: string,
  ): string | null {
    if (!userText) {
      return null;
    }

    const trimmed = userText.trim();
    if (!trimmed) {
      return null;
    }

    const explicitMatch = trimmed.match(/^status\s+([A-Za-z0-9-]+)/i);
    if (explicitMatch?.[1]) {
      return explicitMatch[1];
    }

    if (/status/i.test(trimmed)) {
      const idMatch = trimmed.match(/ESAF-\d{4}-\d{4}/i);
      if (idMatch?.[0]) {
        return idMatch[0];
      }
    }

    if (trimmed.toLowerCase().startsWith("status") && knownRequestId) {
      return knownRequestId;
    }

    return null;
  }

  private async respondWithStatus(
    requestId: string,
    metadata: FinanceIntakeMetadata,
    task: Task,
    taskId: string,
    contextId: string,
    _userMessage: Message,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const summaryResult = await this.querySummaryAgentForStatus(requestId);
    let workingMetadata = { ...metadata };

    if (summaryResult?.statusRecord) {
      workingMetadata = {
        ...workingMetadata,
        statusRecord: summaryResult.statusRecord,
        statusText:
          summaryResult.statusRecord.summaryForRequester ??
          summaryResult.summaryText,
      };
      task = withUpdatedMetadata(task, workingMetadata);
      eventBus.publish(task);
    }

    const replyText =
      summaryResult?.summaryText ??
      `I couldn't find a request with reference ID ${requestId}.`;

    const state: TaskStatusUpdateEvent["status"]["state"] =
      summaryResult?.summaryText ? "completed" : "failed";

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
    logInfo(
      `Responded to status query for ${requestId} (state=${state}, task ${taskId}).`,
    );
  }
}
