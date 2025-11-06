import {
  exampleFinanceRequest,
  examplePolicyDecision,
  exampleStatusRecord,
} from "../src/finance/examples.js";
import type { SummaryStoreRecord } from "../src/agents/finance-summary-agent/types.js";
import { generateSummaries } from "../src/agents/finance-summary-agent/summariser.js";

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required to run this smoke test.");
    process.exit(1);
    return;
  }

  const record: SummaryStoreRecord = {
    financeRequest: exampleFinanceRequest,
    policyDecision: examplePolicyDecision,
    status: exampleStatusRecord,
  };

  console.log("Generating summaries for", record.status.requestId);
  const summaries = await generateSummaries(record);
  console.log("Requester summary:\n", summaries.summaryForRequester);
  console.log("Approver summary:\n", summaries.summaryForApprover);
}

void main().catch((err) => {
  console.error("Summariser smoke test failed", err);
  process.exitCode = 1;
});
