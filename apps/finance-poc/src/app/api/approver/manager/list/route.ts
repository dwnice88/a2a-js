import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { APPROVER_AGENT_URL } from "@/config/agents";
import type { ApproverListResponse } from "@/types/approver";
import { extractInboxItems } from "../../list-helpers";

export async function GET() {
  try {
    const metadata = {
      approverPayload: {
        intent: "list_pending",
        role: "manager",
      },
    };

    const rpcPayload = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: "list manager approvals" }],
          metadata,
        },
      },
    };

    const response = await fetch(`${APPROVER_AGENT_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    if (!response.ok) {
      throw new Error(`Approver agent responded with ${response.status}`);
    }

    const json = await response.json();
    const result = json?.result;
    const taskMetadata = (result?.task?.metadata ??
      result?.metadata ??
      {}) as Record<string, unknown>;
    const items = extractInboxItems(taskMetadata, "manager");
    const summaryText =
      taskMetadata?.summaryText ??
      taskMetadata?.approverInbox?.summaryText ??
      taskMetadata?.statusText;

    const payload: ApproverListResponse = summaryText
      ? { items, summaryText }
      : { items };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Manager list inbox error", error);
    const fallback: ApproverListResponse = { items: [] };
    return NextResponse.json(fallback, { status: 502 });
  }
}
