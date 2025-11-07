import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { APPROVER_AGENT_URL } from "@/config/agents";
import type { ApproverDecisionRequest } from "@/types/approver";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ApproverDecisionRequest;

    if (!body.requestId || !body.outcome) {
      return NextResponse.json(
        { ok: false, message: "Missing requestId or outcome." },
        { status: 400 },
      );
    }

    const metadata = {
      approverPayload: {
        intent: "submit_decision",
        requestId: body.requestId,
        role: "director",
        outcome: body.outcome,
        ...(body.comment ? { comment: body.comment } : {}),
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
          parts: [{ kind: "text", text: "submit director decision" }],
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

    await response.json();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Director decision error", error);
    return NextResponse.json(
      { ok: false, message: "Could not submit decision." },
      { status: 502 },
    );
  }
}
