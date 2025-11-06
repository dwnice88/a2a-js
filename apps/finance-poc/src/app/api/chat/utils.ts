import type { ChatResponsePayload } from "@/types/chat";

export function extractReplyFromResult(
  result: any,
  fallback = "Sorry, I couldn't understand the response.",
): {
  text: string;
  taskMetadata?: Record<string, unknown>;
} {
  if (!result) {
    return { text: fallback };
  }

  if (result.kind === "task") {
    const text = getTextFromMessage(result.status?.message) ?? fallback;
    return {
      text,
      taskMetadata: (result.metadata ?? undefined) as Record<string, unknown>,
    };
  }

  if (result.kind === "message") {
    const text = getTextFromMessage(result) ?? fallback;
    return {
      text,
      taskMetadata: (result.metadata ?? undefined) as Record<string, unknown>,
    };
  }

  const text =
    getTextFromMessage(result?.message) ??
    getTextFromMessage(result?.status?.message) ??
    fallback;

  return { text };
}

export function buildErrorPayload(message: string): ChatResponsePayload {
  return {
    messages: [
      {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: message,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getTextFromMessage(message: any): string | undefined {
  if (!message?.parts || !Array.isArray(message.parts)) {
    return undefined;
  }

  const textPart = message.parts.find(
    (part: { kind?: string }) => part.kind === "text",
  );
  return textPart?.text as string | undefined;
}
