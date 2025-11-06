import OpenAI from "openai";
import type { PlannerInput, PlannerOutput } from "./types.js";

const FINANCE_INTAKE_DEBUG =
  process.env.FINANCE_INTAKE_DEBUG === "1" ||
  process.env.FINANCE_INTAKE_DEBUG === "true";

function logPlannerError(message: string, ...args: unknown[]) {
  console.error("[FinanceIntakePlanner][error]", message, ...args);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function runFinanceIntakePlanner(
  input: PlannerInput,
): Promise<PlannerOutput> {
  const {
    userText,
    partialRequest,
    missingFields,
    completedFields,
    lastQuestion,
    mode,
  } = input;

  const payload = {
    userText,
    partialRequest,
    missingFields,
    completedFields,
    lastQuestion,
    mode: mode ?? "normal",
  };

  const prompt = `

SYSTEM:


You are the Finance Intake Agent for an Essential Spend Authorisation (ESAF) process.

You receive:

A JSON payload containing the current partial FinanceRequest (partialRequest),
the list of missingFields and completedFields, and the lastQuestion.

A userText string containing the latest free-text message from the requester.

Your job:

Carefully read userText and infer values for missing fields on the FinanceRequest.

Update partialRequest with any new values you can confidently infer.

Move fields from missingFields to completedFields when you have a clear value.

Do NOT remove or change any values already present in partialRequest unless the user clearly corrects them.

Avoid asking the same question again if userText clearly answers that field.

FinanceRequest schema (fields you care about):

directorate: string
High-level directorate owning the spend (e.g. "Adults' Care & Support").
If the user says "This is for X" or "Directorate: X" or similar, map X to directorate.

serviceName: string
Service name (e.g. "Adult Social Care").
If the user says "Service: X", "for the X service", "service is X", map X to serviceName.

costCentreCode: string
Cost Centre / Project Code (e.g. "AC1234").
Look for tokens like "AC1234", "CC1234", or phrases like "cost centre AC1234".

typeOfSpend: one of "goods", "services", "consultancy", "travel", "grants", "other".
Map phrases like "type of spend: services", "consultancy support", "travel costs", etc.

amountExclVAT: { amount: number; currency: "GBP" }
Numeric amount in pounds, excluding VAT.
If the user says "around £10,000", "amount is 10000", "for £5k", infer amountExclVAT.amount as a number in GBP.

ringFencedFunding: string ("Yes" / "No" text is fine)

isBusinessCritical: string ("Yes" / "No")

isStatutory: string ("Yes" / "No")

canBeDeferred: string ("Yes" / "No")

hasContractInPlace: string ("Yes" / "No")

Map natural language to these flags. Examples:

"business critical" -> isBusinessCritical = "Yes"

"not business critical" -> isBusinessCritical = "No"

"non-statutory" -> isStatutory = "No"

"cannot be deferred" / "can't be deferred" -> canBeDeferred = "No"

"can be deferred" -> canBeDeferred = "Yes"

"there is a contract in place" -> hasContractInPlace = "Yes"

"no contract in place" -> hasContractInPlace = "No"

descriptionOfSpend: string
Short description of what the spend is for (e.g. "Emergency accommodation for vulnerable resident.").

justification: string
Longer explanation of why this is critical / cannot be avoided.

headOfFinance: string
Name of the Head of Finance (e.g. "Jane Smith").

executiveTeamOrDelegate: string
Name/label of the Executive Team member or delegate (e.g. "Executive Director – People").

Important pattern examples:

If userText contains "Adults' Care & Support", treat that as:

directorate = "Adults' Care & Support"
unless a different directorate is explicitly given.

If userText contains "Service: Adult Social Care", treat that as:

serviceName = "Adult Social Care"

If userText says "cost centre AC1234" or "AC1234 cost centre", set:

costCentreCode = "AC1234"

If userText says "amount about £10,000", set:

amountExclVAT = { "amount": 10000, "currency": "GBP" }

If userText says "business critical", set:

isBusinessCritical = "Yes"

If userText says "non-statutory", set:

isStatutory = "No"

If userText says "cannot be deferred" or similar, set:

canBeDeferred = "No"

If userText says "there is a contract in place", set:

hasContractInPlace = "Yes"

When deciding the next question:

Look at missingFields AFTER you have applied any new inferences from userText.

Do NOT ask about a field that you have just filled.

Ask for ONE missing field at a time, in a clear and concise way.

If all required fields are present, set isComplete = true and nextQuestion = null.

If mode is "normal":

Behave as above, filling in what you can and asking for the most important missing field.

If mode is "shortcut":

Assume the user is trying to give you everything in one or two messages.

Be more aggressive in inferring all missing fields from userText.

Aim to set isComplete = true as soon as you reasonably can.

Additional rules:

- Treat any phrase that obviously answers the lastQuestion as a direct answer.
- Once you have filled a field from userText, never include that field in missingFields again unless the user explicitly says the previous value was wrong.
- Avoid asking exactly the same wording of lastQuestion if userText contains new, relevant information.

Return STRICT JSON ONLY with this shape:

{
"updatedRequest": { ...partial FinanceRequest fields... },
"missingFields": ["fieldName1", "fieldName2"],
"completedFields": ["fieldNameA", "fieldNameB"],
"nextQuestion": "your next natural language question or null if complete",
"isComplete": true or false
}

USER INPUT (JSON):
${JSON.stringify(payload, null, 2)}
`.trim();

  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    input: prompt,
  });

  const rawText = response.output[0]?.content[0]?.text ?? "{}";

  // 1) Clean out markdown fences / extra text and extract the JSON object
  let jsonText = rawText.trim();

  // If the model wrapped the JSON in ```json ... ``` code fences, strip them.
  if (jsonText.startsWith("```")) {
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }
  }

  // As a second safety net, if there's still extra text before or after,
  // try to isolate the JSON object by braces again.
  if (!jsonText.trim().startsWith("{") || !jsonText.trim().endsWith("}")) {
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: PlannerOutput;
  try {
    parsed = JSON.parse(jsonText) as PlannerOutput;
  } catch (err) {
    logPlannerError("Failed to parse JSON from model output", err, rawText);
    parsed = {
      updatedRequest: partialRequest,
      missingFields,
      completedFields,
      nextQuestion:
        "Sorry, I had trouble interpreting that. Could you rephrase or give more detail about your spend?",
      isComplete: false,
    };
  }

  if (FINANCE_INTAKE_DEBUG) {
    console.debug(
      "[FinanceIntakePlanner][debug] Parsed planner output:",
      JSON.stringify(parsed, null, 2),
    );
  }

  return parsed;
}
