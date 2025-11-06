// scripts/testFinancePolicyAgent.ts
//
// Simple smoke test for the Finance Policy Agent (Agent B).
// Assumptions:
// - Finance Policy Agent is running on port 41002
//   via `npm run finance-policy-agent`
// - A2AClient is available from src/client/index.ts
// - FinanceRequest / PolicyDecision types are exported from src/finance/index.ts

import { A2AClient } from '../src/client/index.js';
import {
  exampleFinanceRequest,
  type FinanceRequest,
  type PolicyDecision,
} from '../src/finance/index.js';
import type { SendMessageResponse } from '../src/a2a_response.js';

/**
 * Helper to create a request with a specific amount and spend type.
 */
function buildRequest(overrides: Partial<FinanceRequest>): FinanceRequest {
  return {
    ...exampleFinanceRequest,
    ...overrides,
  };
}

/**
 * Run a single policy test and log the result in a human-friendly way.
 */
async function testRequest(
  label: string,
  financeRequest: FinanceRequest,
): Promise<void> {
  console.log(`\n=== ${label} ===`);

  // 1. Discover the agent via its card
  const client = await A2AClient.fromCardUrl(
    'http://localhost:41002/.well-known/agent-card.json',
  );

  // 2. Build a user message carrying the FinanceRequest in metadata
  const message = {
    kind: 'message' as const,
    role: 'user' as const,
    messageId: `test-${Date.now()}-${Math.random()}`,
    parts: [
      {
        kind: 'text' as const,
        text: 'Please evaluate this finance request.',
      },
    ],
    metadata: {
      financeRequest,
    },
  };

  // 3. Call message/send in blocking mode
  const rpcResponse: SendMessageResponse = await client.sendMessage({
    message,
    configuration: {
      // blocking: true is the default, but we state it explicitly
      blocking: true,
    },
  });

  // 4. Handle JSON-RPC errors
  if ('error' in rpcResponse) {
    console.error('❌ JSON-RPC error from policy agent:', rpcResponse.error);
    throw new Error(
      `Policy agent returned JSON-RPC error: ${rpcResponse.error.message}`,
    );
  }

  // 5. Extract the result (single Message or Task object)
  const result = rpcResponse.result;

  if (!result) {
    throw new Error('Policy agent response had no result.');
  }

  // For the Finance Policy Agent we expect a Task with metadata
  if (result.kind !== 'task') {
    console.warn('⚠️ Expected a Task result but got:', result.kind);
  }

  const task = result;

  // 6. Pull the PolicyDecision out of task.metadata
  const metadata = (task.metadata ?? {}) as {
    financeRequest?: FinanceRequest;
    policyDecision?: PolicyDecision;
  };

  if (!metadata.policyDecision) {
    console.error('❌ No policyDecision found in task.metadata.');
    console.dir(task, { depth: 5 });
    throw new Error('policyDecision missing from task.metadata');
  }

  const decision = metadata.policyDecision;

  console.log('✅ Policy decision received:');
  console.log(`  decisionState:        ${decision.decisionState}`);
  console.log(`  requiredApprovalPath: ${decision.requiredApprovalPath}`);
  console.log('  reasons:');
  for (const reason of decision.reasons) {
    console.log(`   - [${reason.code}] ${reason.message}`);
  }
}

/**
 * Entry point: run three simple cases.
 */
async function run(): Promise<void> {
  try {
    // 1) Manager-only case (e.g. £10,000, services)
    await testRequest(
      'Case 1 – 10k services (manager-only expected)',
      buildRequest({
        amountExclVAT: { amount: 10_000, currency: 'GBP' },
        typeOfSpend: 'services',
      }),
    );

    // 2) Manager + director case (e.g. £30,000, services)
    await testRequest(
      'Case 2 – 30k services (manager + director expected)',
      buildRequest({
        amountExclVAT: { amount: 30_000, currency: 'GBP' },
        typeOfSpend: 'services',
      }),
    );

    // 3) Disallowed spend type (e.g. travel – should be auto_rejected)
    await testRequest(
      'Case 3 – 5k travel (disallowed – auto_rejected expected)',
      buildRequest({
        amountExclVAT: { amount: 5_000, currency: 'GBP' },
        typeOfSpend: 'travel',
      }),
    );

    console.log('\n🎉 Finance Policy Agent smoke test completed.');
  } catch (err) {
    console.error('\nError running finance policy smoke test:', err);
    process.exitCode = 1;
  }
}

void run();
