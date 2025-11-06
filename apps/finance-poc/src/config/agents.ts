export const AGENT_BASE_URLS = {
  intake: "http://localhost:41001",
  approver: "http://localhost:41004",
  summary: "http://localhost:41003",
} as const;

export type AgentKind = keyof typeof AGENT_BASE_URLS;
