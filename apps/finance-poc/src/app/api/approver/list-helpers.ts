import type {
  ApproverInboxItem,
  ApproverRole,
} from "@/types/approver";

type UnknownRecord = Record<string, unknown>;

interface MetadataWithInbox extends UnknownRecord {
  approverInbox?: unknown;
  pendingItems?: unknown;
  items?: unknown;
}

export function extractInboxItems(
  metadata: UnknownRecord,
  role: ApproverRole,
): ApproverInboxItem[] {
  const record = metadata as MetadataWithInbox;
  const rawItems =
    asArray(getNested(record.approverInbox, "items")) ??
    asArray(record.approverInbox) ??
    asArray(record.pendingItems) ??
    asArray(record.items) ??
    [];

  return rawItems
    .map((candidate) => {
      if (!isRecord(candidate)) {
        return null;
      }

      const requestId =
        toStringSafe(candidate.requestId) ?? toStringSafe(candidate.id);
      const summary =
        toStringSafe(candidate.summaryForApprover) ??
        toStringSafe(candidate.summary) ??
        "";

      if (!requestId || !summary) {
        return null;
      }

      const financeRequest = isRecord(candidate.financeRequest)
        ? candidate.financeRequest
        : undefined;

      return {
        requestId,
        approverRole: role,
        createdAt:
          toStringSafe(candidate.createdAt) ??
          toStringSafe(candidate.submittedAt) ??
          new Date().toISOString(),
        summaryForApprover: summary,
        directorate:
          toStringSafe(candidate.directorate) ??
          toStringSafe(financeRequest?.directorate),
        serviceName:
          toStringSafe(candidate.serviceName) ??
          toStringSafe(financeRequest?.serviceName),
        amountLabel:
          toStringSafe(candidate.amountLabel) ??
          formatAmount(financeRequest?.amountExclVAT),
      } satisfies ApproverInboxItem;
    })
    .filter((value): value is ApproverInboxItem => Boolean(value));
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getNested(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return (value as UnknownRecord)[key];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toStringSafe(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatAmount(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const amount = typeof value.amount === "number" ? value.amount : undefined;
  const currency =
    typeof value.currency === "string" ? value.currency : undefined;

  if (amount === undefined || !currency) {
    return undefined;
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
