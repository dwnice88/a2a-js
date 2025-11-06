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
  FinanceApproverAgentExecutor,
  logInfo,
  logError,
} from "./executor.js";

const financeApproverAgentCard: AgentCard = {
  name: "Finance Approver Agent",
  description:
    "Manages approval inboxes for managers and directors and forwards their decisions to the summary service.",
  url: "http://localhost:41004/",
  provider: {
    organization: "LBBD Innovation Team",
    url: "https://example.com/finance-approver",
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
      id: "finance_approver",
      name: "Finance Approver Inbox",
      description:
        "Routes ESAF requests to approvers, lists pending work, and relays manager/director decisions.",
      tags: ["finance", "approver", "status"],
      inputModes: ["text"],
      outputModes: ["text", "task-status"],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main(): Promise<void> {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new FinanceApproverAgentExecutor();

  const requestHandler = new DefaultRequestHandler(
    financeApproverAgentCard,
    taskStore,
    agentExecutor,
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  const PORT = process.env.PORT || 41004;
  expressApp.listen(PORT, (err?: unknown) => {
    if (err) {
      throw err;
    }

    const baseUrl = `http://localhost:${PORT}`;
    logInfo(`Finance Approver Agent listening on ${baseUrl}`);
    logInfo(
      `Agent Card available at ${baseUrl}/.well-known/agent-card.json`,
    );
    logInfo(
      "Tip: run 'npm run a2a:cli http://localhost:41004' to interact with this agent.",
    );
  });
}

main().catch((err) => {
  logError("Fatal error starting Finance Approver Agent server", err);
});
