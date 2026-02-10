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

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

@Injectable()
export class GeminiLlmClient implements ILlmClient {
  private readonly logger = new Logger(GeminiLlmClient.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY') ?? '';
    this.model =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
    this.baseUrl =
      this.config.get<string>('GEMINI_BASE_URL') ??
      'https://generativelanguage.googleapis.com/v1beta/models';

    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not set. Gemini calls will fail until it is configured.',
      );
    }
  }

  async generateReply(
    messages: ChatMessageDto[],
    options?: LlmOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'Gemini is not configured (missing GEMINI_API_KEY).',
      );
    }

    const contents: GeminiContent[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemMessage = messages.find((m) => m.role === 'system');

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 600,
      },
    };

    if (systemMessage) {
      body.systemInstruction = {
        role: 'system',
        parts: [{ text: systemMessage.content }],
      };
    }

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response$ = this.http.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await firstValueFrom(response$);
      const candidate = response.data?.candidates?.[0];
      const text: string | undefined =
        candidate?.content?.parts?.[0]?.text ??
        candidate?.content?.parts?.map((p: GeminiPart) => p.text).join('\n');

      const trimmed = text?.trim() ?? '';
      if (!trimmed) {
        this.logger.warn('Empty response from Gemini');
        throw new InternalServerErrorException(
          'LLM returned an empty response.',
        );
      }

      return trimmed;
    } catch (error) {
      this.logger.error('Error calling Gemini', error as Error);
      throw new InternalServerErrorException('Failed to generate a reply.');
    }
  }
}

