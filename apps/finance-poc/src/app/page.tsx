"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatApiResponse, ChatMessage } from "@/types/chat";
import type { StatusRecord } from "@/types/status";

const STATUS_POLL_INTERVAL_MS = 5000;
const FINAL_STATES = new Set(["approved", "rejected", "declined", "completed"]);

export default function RequesterPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [taskId, setTaskId] = useState<string | undefined>();
  const [contextId, setContextId] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [statusRecord, setStatusRecord] = useState<StatusRecord | null>(null);
  const [isStatusPolling, setIsStatusPolling] = useState(false);
  const [lastStatusText, setLastStatusText] = useState<string | null>(null);
  const lastStatusTextRef = useRef<string | null>(null);

  useEffect(() => {
    lastStatusTextRef.current = lastStatusText;
  }, [lastStatusText]);

  async function handleSend() {
    if (!input.trim()) {
      return;
    }

    setError(null);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: input,
      createdAt: new Date().toISOString(),
      taskId,
      contextId,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/chat/requester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.text,
          taskId,
          contextId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as ChatApiResponse;
      setMessages((prev) => [...prev, data.reply]);
      setTaskId(data.taskId);
      setContextId(data.contextId);
      const maybeId = extractRequestId(data.reply.text);
      if (maybeId) {
        setActiveRequestId((prev) => {
          if (prev !== maybeId) {
            setStatusRecord(null);
            setLastStatusText(null);
          }
          return maybeId;
        });
        setIsStatusPolling(true);
      }
    } catch (e) {
      console.error("Requester chat send error", e);
      setError("I couldn't reach the finance agent. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    if (!activeRequestId || !isStatusPolling) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/finance/status?requestId=${encodeURIComponent(activeRequestId)}`,
        );
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as {
          messageText?: string;
          statusRecord?: StatusRecord;
        };

        if (cancelled) {
          return;
        }

        if (
          data.messageText &&
          data.messageText !== lastStatusTextRef.current
        ) {
          const statusMessage: ChatMessage = {
            id: `status-${Date.now()}`,
            role: "agent",
            text: data.messageText,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, statusMessage]);
          setLastStatusText(data.messageText);
        }

        if (data.statusRecord) {
          setStatusRecord(data.statusRecord);
          const currentState = data.statusRecord.currentState
            ? data.statusRecord.currentState.toLowerCase()
            : undefined;
          if (currentState && FINAL_STATES.has(currentState)) {
            setIsStatusPolling(false);
          }
        }
      } catch (pollError) {
        console.error("Status polling failed", pollError);
      }
    };

    const intervalId = setInterval(poll, STATUS_POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeRequestId, isStatusPolling]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Finance ESAF Requester</h1>
      <p>Start by typing “Start finance request”.</p>
      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      {activeRequestId ? (
        <p>
          Tracking request: <strong>{activeRequestId}</strong>
        </p>
      ) : null}
      {statusRecord ? (
        <div
          style={{
            border: "1px solid #cbd5f5",
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            backgroundColor: "#f8fafc",
          }}
        >
          <p style={{ margin: "0 0 4px" }}>
            Latest status:{" "}
            <strong>{statusRecord.currentState ?? "in progress"}</strong>
          </p>
          {statusRecord.summaryForRequester ? (
            <p style={{ margin: 0 }}>{statusRecord.summaryForRequester}</p>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          padding: 8,
          borderRadius: 8,
          minHeight: 300,
          maxHeight: 400,
          overflowY: "auto",
          marginBottom: 16,
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              textAlign: message.role === "user" ? "right" : "left",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: 8,
                borderRadius: 6,
                backgroundColor:
                  message.role === "user" ? "#e0f7ff" : "#f4f4f5",
                color: "#111827",
              }}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!isSending) {
                void handleSend();
              }
            }
          }}
          placeholder="Type here…"
          rows={3}
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={isSending}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#2563eb",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {isSending ? "Sending…" : "Send"}
        </button>
      </div>
    </main>
  );
}

function extractRequestId(text: string): string | null {
  const match = text.match(/(ESAF-\d{4}-\d{4})/i);
  return match ? match[1].toUpperCase() : null;
}
