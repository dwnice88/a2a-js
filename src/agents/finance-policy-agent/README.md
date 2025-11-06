# Finance Policy Agent

## Purpose
Applies the ESAF finance policy to structured requests, determining whether spends are blocked outright or which approval path (manager-only vs. manager+director) is required. Runs as an A2A-compliant agent on port `41002`.

## How to run
```bash
export OPENAI_API_KEY=sk-yourkey   # optional unless other agents need it
npm run agents:finance-policy
```

## How to interact
- Use the intake agent or another producer to send a `financeRequest` in message metadata.
- For quick manual checks, run `npm run test:finance-policy-agent` (requires the server to be running on `http://localhost:41002`).
- Direct CLI: `npm run a2a:cli http://localhost:41002`.

## Environment variables
- `FINANCE_POLICY_DEBUG=1` – enable verbose `[FinancePolicy][debug]` logs.
- `PORT` – override default `41002` if desired.

## Behaviour overview
1. Rejects disallowed spend types (`travel`, `consultancy`, `grants`).
2. Applies thresholds from `src/finance/policyConfig.ts`.
3. Publishes a final `TaskStatusUpdateEvent` with the structured decision and a human-readable summary.
