import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { StatusRecord } from "@/types/status";

const INTAKE_AGENT_URL =
  process.env.FINANCE_INTAKE_AGENT_URL ?? "http://localhost:41001";

interface RpcMessage {
  parts?: Array<{ kind?: string; text?: string }>;
}

interface RpcResultTask {
  kind?: string;
  metadata?: {
    statusRecord?: StatusRecord;
  };
  status?: {
    message?: RpcMessage;
  };
  message?: RpcMessage;
}

interface StatusResponsePayload {
  messageText: string;
  statusRecord?: StatusRecord;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const result = await sendStatusQuery(requestId);
  return NextResponse.json(result.payload, { status: result.status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    requestId?: string;
  } | null;
  const requestId = body?.requestId;
  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const result = await sendStatusQuery(requestId);
  return NextResponse.json(result.payload, { status: result.status });
}

async function sendStatusQuery(
  requestId: string,
): Promise<{ status: number; payload: StatusResponsePayload }> {
  try {
    const userText = `status ${requestId}`;
    const rpcPayload = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: userText }],
          metadata: {},
        },
      },
    };

    const agentUrl = INTAKE_AGENT_URL.endsWith("/")
      ? INTAKE_AGENT_URL
      : `${INTAKE_AGENT_URL}/`;

    const response = await fetch(agentUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload),
    });

    if (!response.ok) {
      return {
        status: response.status,
        payload: {
          messageText: "Unable to reach the finance intake agent for status.",
        },
      };
    }

    const json = (await response.json()) as { result?: RpcResultTask };
    const result = json?.result;

    const statusRecord = result?.metadata?.statusRecord;
    const messageText =
      extractTextFromResult(result) ??
      "I couldn't parse the finance agent response.";

    return { status: 200, payload: { messageText, statusRecord } };
  } catch (error) {
    console.error("Finance status query failed", error);
    return {
      status: 502,
      payload: {
        messageText:
          "Something went wrong while requesting the latest status. Please try again.",
      },
    };
  }
}

function extractTextFromResult(result?: RpcResultTask): string | undefined {
  if (!result) {
    return undefined;
  }

  if (result.kind === "task") {
    return (
      extractTextFromMessage(result.status?.message) ??
      extractTextFromMessage(result.message)
    );
  }

  if (result.kind === "message") {
    return extractTextFromMessage(result);
  }

  return (
    extractTextFromMessage(result.status?.message) ??
    extractTextFromMessage(result.message)
  );
}

function extractTextFromMessage(message?: RpcMessage): string | undefined {
  if (!message?.parts) {
    return undefined;
  }

  const textPart = message.parts.find((part) => part?.kind === "text");
  return textPart?.text ?? undefined;
}
