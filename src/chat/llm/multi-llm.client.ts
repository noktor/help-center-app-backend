import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMessageDto } from '../dto/chat-request.dto';
import { ILlmClient, LlmOptions } from './llm-client.interface';
import { GeminiLlmClient } from './gemini-llm.client';
import { OpenAiLlmClient } from './openai-llm.client';
import { MockLlmClient } from './mock-llm.client';
import { FreeflowLlmClient } from './freeflow-llm.client';

type ProviderId = 'gemini' | 'openai' | 'mock' | 'freeflow';

interface ProviderEntry {
  id: ProviderId;
  client: ILlmClient;
}

@Injectable()
export class MultiLlmClient implements ILlmClient {
  private readonly logger = new Logger(MultiLlmClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly geminiClient: GeminiLlmClient,
    private readonly openAiClient: OpenAiLlmClient,
    private readonly mockClient: MockLlmClient,
    private readonly freeflowClient: FreeflowLlmClient,
  ) {}

  private getOrderedProviders(): ProviderEntry[] {
    const primary = (this.config.get<string>('LLM_PROVIDER') ??
      'gemini') as ProviderId;

    if (primary === 'freeflow') {
      return [
        { id: 'freeflow', client: this.freeflowClient },
        { id: 'gemini', client: this.geminiClient },
        { id: 'openai', client: this.openAiClient },
        { id: 'mock', client: this.mockClient },
      ];
    }

    if (primary === 'openai') {
      return [
        { id: 'openai', client: this.openAiClient },
        { id: 'gemini', client: this.geminiClient },
        { id: 'mock', client: this.mockClient },
      ];
    }

    if (primary === 'mock') {
      return [{ id: 'mock', client: this.mockClient }];
    }

    // Default: gemini first
    return [
      { id: 'gemini', client: this.geminiClient },
      { id: 'openai', client: this.openAiClient },
      { id: 'mock', client: this.mockClient },
    ];
  }

  async generateReply(
    messages: ChatMessageDto[],
    options?: LlmOptions,
  ): Promise<string> {
    const providers = this.getOrderedProviders();

    let lastError: unknown;

    for (const provider of providers) {
      try {
        this.logger.log(
          `Trying provider "${provider.id}" to generate reply...`,
        );
        const reply = await provider.client.generateReply(messages, options);
        this.logger.log(`Provider "${provider.id}" succeeded.`);
        return reply;
      } catch (error) {
        lastError = error;
        this.logger.error(
          `Provider "${provider.id}" failed, trying next if available.`,
          error as Error,
        );
      }
    }

    this.logger.error(
      'All configured LLM providers failed. Returning generic error.',
      lastError as Error,
    );
    throw lastError ?? new Error('All LLM providers failed.');
  }
}

