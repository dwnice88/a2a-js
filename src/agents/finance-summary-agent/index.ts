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
  FinanceSummaryAgentExecutor,
  logInfo,
  logError,
} from "./executor.js";

const financeSummaryAgentCard: AgentCard = {
  name: "Finance Summary & Status Agent",
  description:
    "Maintains ESAF request status and generates human-readable summaries for requesters and approvers.",
  url: "http://localhost:41003/",
  provider: {
    organization: "LBBD Innovation Team",
    url: "https://example.com/finance-summary",
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
      id: "finance_summary",
      name: "Finance Summary & Status",
      description:
        "Generates summaries and tracks lifecycle state for ESAF requests.",
      tags: ["finance", "summary", "status"],
      inputModes: ["text"],
      outputModes: ["text", "task-status"],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

async function main(): Promise<void> {
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor: AgentExecutor = new FinanceSummaryAgentExecutor();

  const requestHandler = new DefaultRequestHandler(
    financeSummaryAgentCard,
    taskStore,
    agentExecutor,
  );

  const appBuilder = new A2AExpressApp(requestHandler);
  const expressApp = appBuilder.setupRoutes(express());

  const PORT = process.env.PORT || 41003;
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
      "Tip: use 'npm run a2a:cli http://localhost:41003' to talk to this agent.",
    );
  });
}

main().catch((err) => {
  logError("Fatal error starting Finance Summary Agent server", err);
});
