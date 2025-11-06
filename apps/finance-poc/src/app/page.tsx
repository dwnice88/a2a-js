"use client";

import { useState } from "react";
import { ChatWindow } from "@/components/ChatWindow";
import type { ChatResponsePayload } from "@/types/chat";

export default function RequesterPage() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const handleSend = async (message: string): Promise<ChatResponsePayload> => {
    try {
      const res = await fetch("/api/chat/requester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        throw new Error(`Requester API failed with status ${res.status}`);
      }

      const data = (await res.json()) as ChatResponsePayload;
      const metadata = data.metadata ?? {};

      if (!requestId && typeof metadata.requestId === "string") {
        setRequestId(metadata.requestId);
      }

      if (typeof metadata.statusText === "string") {
        setStatusHint(metadata.statusText);
      }

      return data;
    } catch (error) {
      console.error("Requester chat error", error);
      return {
        messages: [
          {
            id: `agent-${Date.now()}`,
            role: "agent",
            text: "I couldn't reach the Finance Intake Agent. Please try again.",
            timestamp: new Date().toISOString(),
          },
        ],
      } satisfies ChatResponsePayload;
    }
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <ChatWindow
        title="Requester – Finance Intake"
        placeholder="Type 'Start finance request' to begin…"
        onSend={handleSend}
        requestId={requestId}
        statusHint={statusHint}
      />
    </main>
  );
}
