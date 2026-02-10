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
      'Això és una resposta de demostració del help center chatbot.',
      'Ara mateix estem treballant amb un mode sense connexió a cap LLM extern.',
      question
        ? `He rebut la teva pregunta: "${question}". En un entorn real, aquí veuries una resposta generada per IA amb els propers passos.`
        : 'En un entorn real, aquí veuries una resposta generada per IA amb els propers passos.',
    ].join('\n\n');
  }
}

