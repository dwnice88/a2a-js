import OpenAI from "openai";
import type { SummaryStoreRecord } from "./types.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const FINANCE_SUMMARY_DEBUG =
  process.env.FINANCE_SUMMARY_DEBUG === "1" ||
  process.env.FINANCE_SUMMARY_DEBUG === "true";

export interface GeneratedSummaries {
  summaryForRequester: string;
  summaryForApprover: string;
}

function buildSimpleSummaries(record: SummaryStoreRecord): GeneratedSummaries {
  const requestId = record.financeRequest?.requestId ?? "this request";
  const amountValue =
    record.financeRequest?.amountExclVAT &&
    typeof record.financeRequest.amountExclVAT.amount === "number"
      ? record.financeRequest.amountExclVAT.amount
      : undefined;
  const amountText =
    amountValue !== undefined
      ? `£${amountValue.toLocaleString("en-GB", {
          minimumFractionDigits: 2,
        })}`
      : "an unspecified amount";
  const state = record.status?.currentState ?? "in progress";

  const requester = `The latest status for ${requestId} is '${state}'. The request is for ${amountText}.`;
  const approver = `Status for ${requestId} is '${state}'. The request is for ${amountText}. Check the history notes for more detail.`;

  return {
    summaryForRequester: requester,
    summaryForApprover: approver,
  };
}

const FALLBACK_SUMMARIES: GeneratedSummaries = {
  summaryForRequester:
    "Here is the latest status of your request. Please check back later for more details.",
  summaryForApprover:
    "Status updated, but a detailed approver summary is not available yet.",
};

export async function generateSummaries(
  record: SummaryStoreRecord,
): Promise<GeneratedSummaries> {
  const payload = {
    financeRequest: record.financeRequest,
    policyDecision: record.policyDecision,
    status: record.status,
  };

  const prompt = `
You are generating finance summaries for a UK local authority (borough council).
Your job is to turn raw Essential Spend Authorisation (ESAF) data into two short
written summaries:

1) summaryForRequester
   - Audience: the council officer who submitted the request.
   - Tone: clear, plain English, reassuring, non-technical.
   - Length: 2–3 sentences.
   - Content:
     * Mention the ESAF requestId.
     * State the current status in friendly language (e.g. "awaiting manager approval").
     * Briefly explain what happens next (e.g. who needs to review or approve it).

2) summaryForApprover
   - Audience: senior manager or director deciding whether to approve the spend.
   - Tone: concise, neutral, leadership-ready. No jargon.
   - Length: 4–7 short bullet-style lines, separated by newline characters (\\n).
   - Focus on the information needed for decision-making:
     * Purpose of the spend and who it supports (service and resident impact).
     * Amount requested (including currency) and any funding information.
     * Whether it is statutory or non-statutory and if it can be deferred.
     * Key risk if the spend is not approved (safeguarding, financial, reputational).
     * Current approval status and which roles are required next (manager, director).
   - Do NOT repeat every data field; give a concise leadership overview.

If the current status is approved, clearly state the request has been approved and can now proceed.

You will be given a JSON object called "data" that includes:
- requestId and basic metadata
- financeRequest (directorate, serviceName, amountExclVAT, descriptionOfSpend, etc.)
- policyDecision (required approval path, outcome, reasoning)
- statusRecord (current state, history, timestamps, any existing summaries)

TASK:
1. Read the "data" object.
2. Write summaryForRequester and summaryForApprover following the rules above.
3. Return ONLY a JSON object with this exact shape:

{
  "summaryForRequester": "string",
  "summaryForApprover": "string"
}

Important:
- Do not include markdown, bullet characters like "-" or "*", or any extra keys.
- Separate lines in summaryForApprover using newline characters (\\n) only.
- If some fields are missing, make sensible, conservative assumptions without inventing facts.

data:
${JSON.stringify(payload)}
`.trim();

  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    const rawText = response.output?.[0]?.content?.[0]?.text ?? "{}";
    let jsonText = rawText.trim();
    if (FINANCE_SUMMARY_DEBUG) {
      console.debug("[FinanceSummary][debug] Raw model text:", jsonText);
    }

    if (jsonText.startsWith("```")) {
      const firstBrace = jsonText.indexOf("{");
      const lastBrace = jsonText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
      }
    }

    if (!jsonText.trim().startsWith("{") || !jsonText.trim().endsWith("}")) {
      const firstBrace = jsonText.indexOf("{");
      const lastBrace = jsonText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
      }
    }

    const parsed = JSON.parse(jsonText) as GeneratedSummaries;

    if (FINANCE_SUMMARY_DEBUG) {
      console.debug(
        "[FinanceSummary][debug] Generated summaries:",
        JSON.stringify(parsed, null, 2),
      );
    }

    if (
      typeof parsed.summaryForRequester === "string" &&
      typeof parsed.summaryForApprover === "string"
    ) {
      return parsed;
    }
  } catch (error) {
    console.error("[FinanceSummary][error] Failed to generate summaries", error);
  }

  if (FINANCE_SUMMARY_DEBUG) {
    console.debug(
      "[FinanceSummary][debug] Falling back to simple summaries for",
      record.financeRequest?.requestId,
    );
  }
  const simple =
    record.financeRequest || record.status
      ? buildSimpleSummaries(record)
      : FALLBACK_SUMMARIES;
  return simple;
}
