import express from "express";
import { v4 as uuidv4 } from "uuid";

import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  Message,
} from "../../index.js";

import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from "../../server/index.js";

import { A2AExpressApp } from "../../server/express/index.js";

const financeIntakeAgentCard: AgentCard = {
  name: "Finance Intake Agent",
  description: "Conversational intake for Essential Spend Authorisation requests.",
  // Base URL for this agent. /a2a is the default base in A2AExpressApp.
  url: "http://localhost:41001/",
  provider: {
    organization: "LBBD Innovation Team",
    url: "https://example.com/finance-intake", // Placeholder URL for now
  },
  version: "0.1.0",
  protocolVersion: "0.3.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text", "task-status"],
  skills: [
    {
      id: "finance_intake",
      name: "Finance Intake",
      description: "Collects ESAF finance request details from a user via chat.",
      tags: ["finance", "intake"],
      inputModes: ["text"],
      outputModes: ["text", "task-status"],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

class FinanceIntakeAgentExecutor implements AgentExecutor {
  public cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    // For now, no special cancellation logic is needed.
  };

  public async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[FinanceIntake] Received message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`,
    );

    // Create a simple "hello" response for now.
    const responseMessage: Message = {
      kind: "message",
      messageId: uuidv4(),
      role: "agent",
      taskId,
      contextId,
      parts: [
        {
          kind: "text",
          text: "Thanks – I'm the Finance Intake Agent and will guide you through your ESAF request shortly.",
        },
      ],
    };

    const statusUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
        message: responseMessage,
      },
      final: true,
    };

    eventBus.publish(statusUpdate);
    eventBus.finished();
  }
}

async function main(): Promise<void> {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new FinanceIntakeAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(
    financeIntakeAgentCard,
    taskStore,
    agentExecutor,
  );

  // 4. Create and setup A2AExpressApp
  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  // 5. Start the server
  const PORT = process.env.PORT || 41001;
  expressApp.listen(PORT, (err?: unknown) => {
    if (err) {
      throw err;
    }
    console.log(
      `[FinanceIntake] Server started on http://localhost:${PORT}`,
    );
    console.log(
      `[FinanceIntake] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`,
    );
    console.log("[FinanceIntake] Press Ctrl+C to stop the server");
  });
}

main().catch((err) => {
  console.error("[FinanceIntake] Fatal error starting server", err);
});
