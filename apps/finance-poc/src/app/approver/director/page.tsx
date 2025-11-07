"use client";

import { useEffect, useState } from "react";
import type {
  ApproverDecisionOutcome,
  ApproverInboxItem,
} from "@/types/approver";

export default function DirectorPage() {
  const [items, setItems] = useState<ApproverInboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadInbox() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/approver/director/list");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: ApproverInboxItem[] };
      setItems(data.items);
    } catch (e) {
      console.error("Director inbox load error", e);
      setError("Could not load director inbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInbox();
    const id = setInterval(() => {
      void loadInbox();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  async function submitDecision(
    requestId: string,
    outcome: ApproverDecisionOutcome,
    comment?: string,
  ) {
    setError(null);
    try {
      const res = await fetch("/api/approver/director/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          role: "director",
          outcome,
          comment,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      await loadInbox();
    } catch (e) {
      console.error("Director decision error", e);
      setError("Could not submit decision.");
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Director approval inbox</h1>
      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      {loading ? <p>Loading…</p> : null}
      {items.length === 0 && !loading ? <p>No pending approvals.</p> : null}

      {items.map((item) => (
        <div
          key={item.requestId}
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <p style={{ margin: "0 0 8px" }}>
            <strong>{item.requestId}</strong> ·{" "}
            {new Date(item.createdAt).toLocaleString()}
          </p>
          <p style={{ margin: "0 0 8px" }}>{item.summaryForApprover}</p>
          {item.directorate ? (
            <p style={{ margin: "0 0 4px" }}>Directorate: {item.directorate}</p>
          ) : null}
          {item.serviceName ? (
            <p style={{ margin: "0 0 4px" }}>Service: {item.serviceName}</p>
          ) : null}
          {item.amountLabel ? (
            <p style={{ margin: "0 0 8px" }}>Amount: {item.amountLabel}</p>
          ) : null}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => submitDecision(item.requestId, "approved")}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => submitDecision(item.requestId, "rejected")}
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() =>
                submitDecision(
                  item.requestId,
                  "more_info_requested",
                  "Need more details.",
                )
              }
            >
              Ask for more info
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
