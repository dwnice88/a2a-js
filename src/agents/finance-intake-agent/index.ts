import 'dotenv/config';

import express from "express";

import type { AgentCard } from "../../index.js";

import { InMemoryTaskStore, DefaultRequestHandler } from "../../server/index.js";
import type { TaskStore, AgentExecutor } from "../../server/index.js";

import { A2AExpressApp } from "../../server/express/index.js";
import { FinanceIntakeAgentExecutor, logInfo, logError } from "./executor.js";

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
    const baseUrl = `http://localhost:${PORT}`;
    logInfo(`Server started on ${baseUrl}`);
    logInfo(
      `Agent Card available at ${baseUrl}/.well-known/agent-card.json`,
    );
    logInfo(
      `Tip: use 'npm run a2a:cli ${baseUrl}' to chat with this agent.`,
    );
    logInfo(
      "Shortcut demo: send '/esaf-shortcut' in the CLI for an instant sample request.",
    );
    logInfo(
      "One-shot intake: paste a full ESAF description and the agent will try to complete all fields.",
    );
    logInfo("Press Ctrl+C to stop the server");
  });
}

main().catch((err) => {
  logError("Fatal error starting server", err);
});
