import { NextResponse } from "next/server";
import { AGENT_BASE_URLS } from "@/config/agents";
import type { ChatResponsePayload } from "@/types/chat";
import { buildErrorPayload, extractReplyFromResult } from "../utils";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { message?: string };
    const userMessage = body?.message ?? "";

    const rpcPayload = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: userMessage }],
          metadata: {},
        },
      },
    };

    const response = await fetch(`${AGENT_BASE_URLS.intake}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    if (!response.ok) {
      throw new Error(`Agent responded with status ${response.status}`);
    }

    const rpcResult = await response.json();
    const { text, taskMetadata } = extractReplyFromResult(rpcResult?.result);
    const requestId =
      (taskMetadata?.intake as { requestId?: string } | undefined)?.requestId ??
      (taskMetadata?.statusRecord as { requestId?: string } | undefined)
        ?.requestId;
    const statusText =
      (taskMetadata?.statusText as string | undefined) ??
      (taskMetadata?.statusRecord as { summaryForRequester?: string } | undefined)
        ?.summaryForRequester;

    const metadata =
      requestId || statusText
        ? {
            ...(requestId ? { requestId } : {}),
            ...(statusText ? { statusText } : {}),
          }
        : undefined;

    const payload: ChatResponsePayload = {
      messages: [
        {
          id: `agent-${Date.now()}`,
          role: "agent",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
      metadata,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error calling intake agent: ", error);
    return NextResponse.json(
      buildErrorPayload(
        "Sorry, I couldn't reach the agent. Please try again shortly.",
      ),
      { status: 200 },
    );
  }
}
