import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ChatMessageDto } from '../dto/chat-request.dto';
import { ILlmClient, LlmOptions } from './llm-client.interface';

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class OpenAiLlmClient implements ILlmClient {
  private readonly logger = new Logger(OpenAiLlmClient.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('OPENAI_API_KEY') ?? '';
    this.model = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4o';

    if (!this.apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY is not set. LLM calls will fail until it is configured.',
      );
    }
  }

  async generateReply(
    messages: ChatMessageDto[],
    options?: LlmOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'LLM is not configured (missing OPENAI_API_KEY).',
      );
    }

    const openAiMessages: OpenAiChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response$ = this.http.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.model,
          messages: openAiMessages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const response = await firstValueFrom(response$);
      const content =
        response.data?.choices?.[0]?.message?.content?.trim() ?? '';

      if (!content) {
        this.logger.warn('Empty response from OpenAI');
        throw new InternalServerErrorException(
          'LLM returned an empty response.',
        );
      }

      return content;
    } catch (error) {
      this.logger.error('Error calling OpenAI', error as Error);
      throw new InternalServerErrorException('Failed to generate a reply.');
    }
  }
}

