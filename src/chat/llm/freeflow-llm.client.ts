import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ChatMessageDto } from '../dto/chat-request.dto';
import { ILlmClient, LlmOptions } from './llm-client.interface';

@Injectable()
export class FreeflowLlmClient implements ILlmClient {
  private readonly logger = new Logger(FreeflowLlmClient.name);
  private readonly serviceUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.serviceUrl =
      this.config.get<string>('FREEFLOW_SERVICE_URL') ??
      'http://localhost:8001';
  }

  async generateReply(
    messages: ChatMessageDto[],
    options?: LlmOptions,
  ): Promise<string> {
    const url = `${this.serviceUrl}/chat`;

    try {
      const response$ = this.http.post(
        url,
        {
          messages,
          temperature: options?.temperature ?? 0.3,
          maxTokens: options?.maxTokens ?? 600,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const response = await firstValueFrom(response$);
      const content: string = response.data?.reply?.trim() ?? '';

      if (!content) {
        this.logger.warn('Empty response from FreeFlow service');
        throw new InternalServerErrorException(
          'LLM returned an empty response.',
        );
      }

      return content;
    } catch (error) {
      this.logger.error('Error calling FreeFlow service', error as Error);
      throw new InternalServerErrorException('Failed to generate a reply.');
    }
  }
}

