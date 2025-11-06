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
SYSTEM:
You are the Finance Summary & Status Agent for an ESAF process.
Produce JSON with "summaryForRequester" and "summaryForApprover" only.

PAYLOAD:
${JSON.stringify(payload, null, 2)}
`.trim();

  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    const rawText = response.output?.[0]?.content?.[0]?.text ?? "{}";
    let jsonText = rawText.trim();

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

  return FALLBACK_SUMMARIES;
}
