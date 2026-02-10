import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ILlmClient } from './llm/llm-client.interface';
import { GeminiLlmClient } from './llm/gemini-llm.client';
import { OpenAiLlmClient } from './llm/openai-llm.client';
import { MockLlmClient } from './llm/mock-llm.client';
import { FreeflowLlmClient } from './llm/freeflow-llm.client';
import { MultiLlmClient } from './llm/multi-llm.client';
import { TravelDataService } from './integrations/travel-data.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    TravelDataService,
    GeminiLlmClient,
    OpenAiLlmClient,
    MockLlmClient,
    FreeflowLlmClient,
    MultiLlmClient,
    {
      provide: 'ILlmClient',
      useFactory: (
        config: ConfigService,
        multiClient: MultiLlmClient,
        mockClient: MockLlmClient,
      ): ILlmClient => {
        const provider = config.get<string>('LLM_PROVIDER') ?? 'gemini';
        if (provider === 'mock') {
          return mockClient;
        }
        return multiClient;
      },
      inject: [ConfigService, MultiLlmClient, MockLlmClient],
    },
  ],
})
export class ChatModule {}

