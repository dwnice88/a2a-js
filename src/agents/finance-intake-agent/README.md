# Finance Intake Agent

## Purpose
This agent handles conversational intake for Essential Spend Authorisation (ESAF) requests. It runs as an A2A server and acts as the main entrypoint for the finance demo.

## How to run
- Requires Node.js, npm, and a valid `OPENAI_API_KEY` in a `.env` file.
- Default port: `41001`.

```bash
export OPENAI_API_KEY=sk-yourkey
npm run agents:finance-intake
```

## How to interact
Use the A2A CLI:

```bash
npm run a2a:cli http://localhost:41001
```

- `/new` – start a new session.
- **Normal intake** – answer ESAF questions conversationally.
- **One-shot intake** – paste a full ESAF description to auto-complete all fields.
- **Shortcut demo** – `/esaf-shortcut` (with no extra text) instantly creates a canned demo ESAF.

## Environment variables
- `OPENAI_API_KEY` – required to call OpenAI for planning.
- `FINANCE_INTAKE_DEBUG=1` – optional; enables verbose debug logging.

## Example one-shot ESAF message
```
This Essential Spend Authorisation request is for the Adults' Care & Support directorate, under the Adult Social Care service. The cost centre code is AC1234. The type of spend is services, with an amount of £10,000 excluding VAT. There is no ring-fenced funding. The spend is business critical, non-statutory, and cannot be deferred. A contract is already in place. The spend covers emergency accommodation for a vulnerable resident who requires immediate housing support. This is necessary to prevent harm and avoid higher long-term costs to the council. The Head of Finance is Jane Smith, and the Executive Team or delegate is the Executive Director – People.
```

## Debug and development
- Set `FINANCE_INTAKE_DEBUG=1` to print planner output and intake metadata logs.
- All agent logs use the `[FinanceIntake]` prefix to make debugging easy.

## Next steps
- Step 4: Implement the Finance Policy Agent.
- Step 5: Wire the intake and policy agents together.
