import { Injectable } from '@nestjs/common';
import { ChatMessageDto } from '../dto/chat-request.dto';
import { ILlmClient, LlmOptions } from './llm-client.interface';

@Injectable()
export class MockLlmClient implements ILlmClient {
  async generateReply(
    messages: ChatMessageDto[],
    _options?: LlmOptions,
  ): Promise<string> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user');

    const question = lastUserMessage?.content ?? '';

    return [
      'This is a demo response from the help center chatbot.',
      'We are currently running in offline mode with no connection to any external LLM.',
      question
        ? `I received your question: "${question}". In a real environment, you would see an AI-generated response with the next steps.`
        : 'In a real environment, you would see an AI-generated response with the next steps.',
    ].join('\n\n');
  }
}

