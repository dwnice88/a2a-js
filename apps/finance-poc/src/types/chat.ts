export type ChatRole = "user" | "agent";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  taskId?: string;
  contextId?: string;
}

export interface ChatApiRequest {
  message: string;
  taskId?: string;
  contextId?: string;
}

export interface ChatApiResponse {
  reply: ChatMessage;
  taskId?: string;
  contextId?: string;
  requestId?: string;
}
