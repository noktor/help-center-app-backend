import { ChatMessageDto } from '../dto/chat-request.dto';

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ILlmClient {
  generateReply(
    messages: ChatMessageDto[],
    options?: LlmOptions,
  ): Promise<string>;
}

