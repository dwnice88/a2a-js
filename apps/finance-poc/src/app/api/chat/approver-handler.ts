import { NextResponse } from "next/server";
import { AGENT_BASE_URLS } from "@/config/agents";
import type { ChatMessage, ChatResponsePayload } from "@/types/chat";
import { buildErrorPayload, extractReplyFromResult } from "./utils";

export type ApproverRole = "manager" | "director";

type ApproverIntent = "list_pending" | "submit_decision";
type ApproverOutcome = "approved" | "rejected";

interface IntentResult {
  intent: ApproverIntent;
  outcome?: ApproverOutcome;
  requestId?: string;
}

interface PendingItem {
  requestId?: string;
  summaryForApprover?: string;
  financeRequest?: {
    serviceName?: string;
    amountExclVAT?: {
      amount?: number;
      currency?: string;
    };
  };
}

export async function handleApproverPost(
  role: ApproverRole,
  request: Request,
) {
  try {
    const body = (await request.json()) as { message?: string };
    const userMessage = body?.message?.trim() ?? "";
    const { intent, outcome, requestId: parsedId } = deriveIntent(userMessage);

    const metadata = buildApproverMetadata(
      role,
      userMessage,
      intent,
      outcome,
      parsedId,
    );

    const rpcPayload = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: userMessage || "list" }],
          metadata,
        },
      },
    };

    const response = await fetch(`${AGENT_BASE_URLS.approver}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    if (!response.ok) {
      throw new Error(`Agent responded with status ${response.status}`);
    }

    const rpcResult = await response.json();
    const { text, taskMetadata } = extractReplyFromResult(rpcResult?.result);
    const pendingItems = extractPendingItems(taskMetadata);

    const baseMessage = createAgentMessage(text);
    const pendingMessages = buildPendingMessages(pendingItems, {
      includeActions: intent === "list_pending",
    });

    const payload: ChatResponsePayload = {
      messages: [baseMessage, ...pendingMessages],
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error(`Error calling ${role} approver agent:`, error);
    return NextResponse.json(
      buildErrorPayload(
        "Sorry, I couldn't reach the agent. Please try again shortly.",
      ),
      { status: 200 },
    );
  }
}

function deriveIntent(message: string): IntentResult {
  if (!message) {
    return { intent: "list_pending" };
  }

  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("approve ")) {
    const potentialId = trimmed.split(/\s+/)[1];
    if (potentialId) {
      return {
        intent: "submit_decision",
        outcome: "approved",
        requestId: potentialId,
      };
    }
  }

  if (lower.startsWith("reject ")) {
    const potentialId = trimmed.split(/\s+/)[1];
    if (potentialId) {
      return {
        intent: "submit_decision",
        outcome: "rejected",
        requestId: potentialId,
      };
    }
  }

  return { intent: "list_pending" };
}

function buildApproverMetadata(
  role: ApproverRole,
  userMessage: string,
  intent: ApproverIntent,
  outcome?: ApproverOutcome,
  requestId?: string,
) {
  if (intent === "submit_decision" && outcome && requestId) {
    return {
      approverPayload: {
        intent: "submit_decision",
        role,
        requestId,
        outcome,
        comment: userMessage,
      },
    };
  }

  return {
    approverPayload: {
      intent: "list_pending",
      role,
    },
  };
}

function extractPendingItems(
  taskMetadata?: Record<string, unknown>,
): PendingItem[] {
  if (!taskMetadata) {
    return [];
  }

  const items = (taskMetadata as { pendingItems?: PendingItem[] }).pendingItems;
  return Array.isArray(items) ? items : [];
}

function buildPendingMessages(
  pendingItems: PendingItem[],
  options: { includeActions: boolean },
): ChatMessage[] {
  if (!pendingItems.length) {
    return [];
  }

  const now = Date.now();

  return pendingItems.reduce<ChatMessage[]>((acc, item, index) => {
    if (!item.requestId) {
      return acc;
    }

    const amountText = formatAmount(item.financeRequest?.amountExclVAT);
    const summaryLines = [
      `${item.requestId} – ${item.financeRequest?.serviceName ?? "Unknown service"}`,
      amountText ? `Amount: ${amountText}` : null,
      item.summaryForApprover ?? null,
    ].filter(Boolean);

    const message: ChatMessage = {
      id: `agent-pending-${now}-${index}`,
      role: "agent",
      text: summaryLines.join("\n"),
      timestamp: new Date().toISOString(),
      actions: options.includeActions
        ? [
            { label: "Approve", command: `approve ${item.requestId}` },
            { label: "Reject", command: `reject ${item.requestId}` },
          ]
        : undefined,
    };

    acc.push(message);
    return acc;
  }, []);
}

function createAgentMessage(text: string): ChatMessage {
  return {
    id: `agent-${Date.now()}`,
    role: "agent",
    text,
    timestamp: new Date().toISOString(),
  };
}

function formatAmount(amount?: { amount?: number; currency?: string }) {
  if (!amount?.amount || !amount.currency) {
    return undefined;
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: amount.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount.amount);
  } catch (error) {
    console.error("Failed to format amount", error);
    return `${amount.currency} ${amount.amount}`;
  }
}
