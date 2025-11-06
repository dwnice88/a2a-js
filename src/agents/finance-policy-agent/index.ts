import "dotenv/config";

import express from "express";

import type { AgentCard } from "../../index.js";
import {
  InMemoryTaskStore,
  DefaultRequestHandler,
} from "../../server/index.js";
import type { TaskStore, AgentExecutor } from "../../server/index.js";

import { A2AExpressApp } from "../../server/express/index.js";
import {
  FinancePolicyAgentExecutor,
  logInfo,
  logError,
} from "./executor.js";

const financePolicyAgentCard: AgentCard = {
  name: "Finance Policy Agent",
  description:
    "Applies ESAF finance policy thresholds and disallowed spend types.",
  url: "http://localhost:41002/",
  provider: {
    organization: "LBBD Innovation Team",
    url: "https://example.com/finance-policy",
  },
  version: "0.1.0",
  protocolVersion: "0.3.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text", "task-status"],
  skills: [
    {
      id: "finance_policy",
      name: "Finance Policy Evaluation",
      description:
        "Evaluates ESAF requests against thresholds and disallowed spend types.",
      tags: ["finance", "policy"],
      inputModes: ["text"],
      outputModes: ["task-status"],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main(): Promise<void> {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new FinancePolicyAgentExecutor();

  const requestHandler = new DefaultRequestHandler(
    financePolicyAgentCard,
    taskStore,
    agentExecutor,
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  const PORT = process.env.PORT || 41002;
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
      "Tip: use 'npm run a2a:cli http://localhost:41002' to talk to this agent.",
    );
  });
}

main().catch((err) => {
  logError("Fatal error starting Finance Policy Agent server", err);
});
