import { Inject, Injectable } from '@nestjs/common';
import { ChatRequestDto, ChatMessageDto } from './dto/chat-request.dto';
import { ILlmClient } from './llm/llm-client.interface';
import {
  OTA_SYSTEM_PROMPT,
  OTA_SYSTEM_PROMPT_WITH_TOOLS,
} from './ota-system-prompt';
import { parseToolAction } from './tools/tool-action.types';
import type { FlightStatusParams, RouteWeatherParams } from './tools/tool-action.types';
import { TravelDataService } from './integrations/travel-data.service';

const MAX_MESSAGES = 12;
const LLM_OPTS = { temperature: 0.3, maxTokens: 600 };

@Injectable()
export class ChatService {
  constructor(
    @Inject('ILlmClient') private readonly llmClient: ILlmClient,
    private readonly travelData: TravelDataService,
  ) {}

  async handleChat(body: ChatRequestDto) {
    const userMessages = body.messages ?? [];

    const messagesPhase1: ChatMessageDto[] = [
      { role: 'system', content: OTA_SYSTEM_PROMPT_WITH_TOOLS },
      ...userMessages,
    ];
    const trimmedPhase1 = [
      messagesPhase1[0],
      ...messagesPhase1.slice(-MAX_MESSAGES),
    ];

    const firstReply = await this.llmClient.generateReply(trimmedPhase1, LLM_OPTS);
    const toolAction = parseToolAction(firstReply);

    if (toolAction === null || toolAction.action === 'none') {
      return { reply: firstReply };
    }

    let toolResultSummary: string;
    if (toolAction.action === 'flight_status') {
      const result = await this.travelData.getFlightStatus(
        (toolAction.params ?? {}) as FlightStatusParams,
      );
      toolResultSummary = `TOOL_RESULT flight_status: ${result.summary}`;
    } else if (toolAction.action === 'route_weather') {
      const result = await this.travelData.getRouteWeather(
        (toolAction.params ?? {}) as RouteWeatherParams,
      );
      toolResultSummary = `TOOL_RESULT route_weather: ${result.summary}`;
    } else {
      return { reply: firstReply };
    }

    const messagesPhase2: ChatMessageDto[] = [
      { role: 'system', content: OTA_SYSTEM_PROMPT },
      ...userMessages,
      { role: 'assistant', content: toolResultSummary },
      {
        role: 'user',
        content:
          'Using the data above, reply to the customer in natural language (short, clear, friendly). Do not repeat raw JSON or technical labels.',
      },
    ];
    const trimmedPhase2 = [
      messagesPhase2[0],
      ...messagesPhase2.slice(-MAX_MESSAGES),
    ];

    const finalReply = await this.llmClient.generateReply(trimmedPhase2, LLM_OPTS);
    return { reply: finalReply };
  }
}

