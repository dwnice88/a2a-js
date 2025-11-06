# Finance Summary & Status Agent

Agent C keeps a per-request status record and produces natural-language summaries tailored for requesters and approvers.

## Prerequisites

Set your OpenAI key before running:

```bash
export OPENAI_API_KEY=sk-your-key
```

## Run the agent

```bash
npm run agents:finance-summary
```

The server listens on http://localhost:41003 and exposes its Agent Card at `/.well-known/agent-card.json`.

## Metadata examples

### Notify the agent of a policy result

```json
{
  "metadata": {
    "summaryPayload": {
      "intent": "policy_result",
      "requestId": "ESAF-2025-0001",
      "financeRequest": { "...": "(FinanceRequest payload)" },
      "policyDecision": { "...": "(PolicyDecision payload)" }
    }
  }
}
```

### Ask for the latest status for a requester

```json
{
  "metadata": {
    "summaryPayload": {
      "intent": "status_query",
      "requestId": "ESAF-2025-0001",
      "audience": "requester"
    }
  }
}
```
