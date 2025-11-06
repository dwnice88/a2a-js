export type ChatRole = "user" | "agent" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: string;
  actions?: Array<{
    label: string;
    command: string;
  }>;
}

export interface ChatRequestPayload {
  message: string;
  uiRole: "requester" | "manager" | "director";
}

export interface ChatResponsePayload {
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
}
