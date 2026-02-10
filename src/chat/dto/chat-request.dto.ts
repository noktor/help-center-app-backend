export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessageDto {
  role: ChatRole;
  content: string;
}

export class ChatRequestDto {
  messages: ChatMessageDto[];
  // Optional extra info for future use (e.g., booking references)
  context?: Record<string, unknown>;
}

