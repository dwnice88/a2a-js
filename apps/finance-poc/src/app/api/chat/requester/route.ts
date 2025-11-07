import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { INTAKE_AGENT_URL } from "@/config/agents";
import type { ChatApiRequest, ChatApiResponse } from "@/types/chat";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatApiRequest;
    const userMessage = body.message ?? "";
    const messageId = crypto.randomUUID();

    const rpcPayload = {
      jsonrpc: "2.0",
      id: messageId,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId,
          parts: [{ kind: "text", text: userMessage }],
          ...(body.taskId ? { taskId: body.taskId } : {}),
          ...(body.contextId ? { contextId: body.contextId } : {}),
          metadata: {},
        },
      },
    };

    const response = await fetch(`${INTAKE_AGENT_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    if (!response.ok) {
      throw new Error(`Agent responded with status ${response.status}`);
    }

    const json = await response.json();
    const result = json?.result;
    const agentMessage = result?.message ?? result?.status?.message;
    const parts = Array.isArray(agentMessage?.parts)
      ? agentMessage.parts
      : [];
    const textPart = parts.find(
      (part: { kind?: string }) => part?.kind === "text",
    );
    const replyText =
      textPart?.text ??
      "Sorry, I couldn't understand the agent response.";

    const taskId = result?.task?.taskId ?? body.taskId;
    const contextId = result?.task?.contextId ?? body.contextId;
    const requestId =
      result?.task?.metadata?.intake?.requestId ??
      result?.task?.metadata?.requestId ??
      result?.task?.metadata?.statusRecord?.requestId;

    const payload: ChatApiResponse = {
      reply: {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: replyText,
        createdAt: new Date().toISOString(),
        taskId,
        contextId,
      },
      taskId,
      contextId,
      requestId,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Requester chat error", error);
    const fallback: ChatApiResponse = {
      reply: {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: "I couldn't reach the finance agent. Please try again.",
        createdAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(fallback, { status: 200 });
  }
}
