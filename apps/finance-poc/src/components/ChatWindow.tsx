"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatResponsePayload } from "@/types/chat";

interface ChatWindowProps {
  title: string;
  placeholder: string;
  onSend: (message: string) => Promise<ChatResponsePayload>;
  initialMessage?: string;
  requestId?: string | null;
  statusHint?: string | null;
}

export function ChatWindow({
  title,
  placeholder,
  onSend,
  initialMessage,
  requestId,
  statusHint,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initialMessageSentRef = useRef(false);

  useEffect(() => {
    if (initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true;
      void handleSend(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (messageOverride?: string) => {
    const trimmed = (messageOverride ?? input).trim();
    if (!trimmed) {
      return;
    }

    const newMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await onSend(trimmed);
      setMessages((prev) => [...prev, ...(response.messages ?? [])]);
    } catch (error) {
      console.error("Chat send error", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `agent-${Date.now()}`,
          role: "agent",
          text: "Something went wrong. Please try again shortly.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (
    event,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleActionClick = (command: string) => {
    void handleSend(command);
  };

  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
      }}
    >
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {requestId ? (
          <div>
            <strong>Reference:</strong> {requestId}
          </div>
        ) : null}
        {statusHint ? (
          <div>
            <strong>Latest status:</strong> {statusHint}
          </div>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 300,
          border: "1px solid #eee",
          borderRadius: 4,
          padding: 8,
          overflowY: "auto",
        }}
      >
        {messages.map((message) => (
          <div key={message.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: message.role === "user" ? 600 : 500 }}>
              {message.role === "user" ? "You" : "Agent"}
            </div>
            <div>{message.text}</div>
            {message.actions && message.actions.length > 0 ? (
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                {message.actions.map((action) => (
                  <button
                    key={action.command}
                    type="button"
                    onClick={() => handleActionClick(action.command)}
                    disabled={isSending}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "1px solid #ccc",
                      cursor: "pointer",
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          value={input}
          placeholder={placeholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            minHeight: 80,
            padding: 8,
            borderRadius: 4,
            border: "1px solid #ccc",
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={isSending}
          style={{
            padding: "8px 12px",
            borderRadius: 4,
            border: "none",
            backgroundColor: "#2563eb",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {isSending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
