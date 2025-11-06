"use client";

import { ChatWindow } from "@/components/ChatWindow";
import type { ChatResponsePayload } from "@/types/chat";

export default function DirectorPage() {
  const handleSend = async (message: string): Promise<ChatResponsePayload> => {
    try {
      const res = await fetch("/api/chat/director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        throw new Error(`Director API failed with status ${res.status}`);
      }

      return (await res.json()) as ChatResponsePayload;
    } catch (error) {
      console.error("Director chat error", error);
      return {
        messages: [
          {
            id: `agent-${Date.now()}`,
            role: "agent",
            text: "Sorry, I couldn't reach the Finance Approver Agent. Please try again shortly.",
            timestamp: new Date().toISOString(),
          },
        ],
      } satisfies ChatResponsePayload;
    }
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <ChatWindow
        title="Director – ESAF Approvals"
        placeholder="Type 'list' to see pending approvals…"
        onSend={handleSend}
        initialMessage="list"
      />
    </main>
  );
}
