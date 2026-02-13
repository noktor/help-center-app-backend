import { Inject, Injectable } from '@nestjs/common';
import { ChatRequestDto, ChatMessageDto } from './dto/chat-request.dto';
import { ILlmClient } from './llm/llm-client.interface';
import {
  OTA_SYSTEM_PROMPT,
  OTA_SYSTEM_PROMPT_WITH_TOOLS,
} from './ota-system-prompt';
import { parseToolAction } from './tools/tool-action.types';
import type {
  FlightStatusParams,
  RouteWeatherParams,
  WeatherAtFlightArrivalParams,
} from './tools/tool-action.types';
import { AviationstackService } from './integrations/aviationstack.service';
import { OpenMeteoService } from './integrations/open-meteo.service';

const MAX_MESSAGES = 12;
const LLM_OPTS = { temperature: 0.3, maxTokens: 600 };

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') && t.includes('action');
}

async function requestNaturalLanguageReply(
  llmClient: ILlmClient,
  userMessages: ChatMessageDto[],
  opts: { temperature?: number; maxTokens?: number },
  maxMessages: number,
): Promise<string> {
  const systemPrompt =
    OTA_SYSTEM_PROMPT +
    '\n\nIMPORTANT: Always reply in natural, friendly language. Never output JSON, code blocks, or raw data structures.';
  const messages: ChatMessageDto[] = [{ role: 'system', content: systemPrompt }, ...userMessages];
  const trimmed = [messages[0], ...messages.slice(-maxMessages)];
  return llmClient.generateReply(trimmed, opts);
}

@Injectable()
export class ChatService {
  constructor(
    @Inject('ILlmClient') private readonly llmClient: ILlmClient,
    private readonly aviationstack: AviationstackService,
    private readonly openMeteo: OpenMeteoService,
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

    if (toolAction === null) {
      const reply = looksLikeJson(firstReply)
        ? await requestNaturalLanguageReply(this.llmClient, userMessages, LLM_OPTS, MAX_MESSAGES)
        : firstReply;
      return { reply };
    }
    if (toolAction.action === 'none') {
      const reply = await requestNaturalLanguageReply(
        this.llmClient,
        userMessages,
        LLM_OPTS,
        MAX_MESSAGES,
      );
      return { reply };
    }

    let toolResultSummary: string;
    if (toolAction.action === 'flight_status') {
      const result = await this.aviationstack.getFlightStatus(
        (toolAction.params ?? {}) as FlightStatusParams,
      );
      toolResultSummary = `TOOL_RESULT flight_status: ${result.summary}`;
    } else if (toolAction.action === 'route_weather') {
      const result = await this.openMeteo.getRouteWeather(
        (toolAction.params ?? {}) as RouteWeatherParams,
      );
      toolResultSummary = `TOOL_RESULT route_weather: ${result.summary}`;
    } else if (toolAction.action === 'weather_at_flight_arrival') {
      const flightResult = await this.aviationstack.getFlightStatus(
        (toolAction.params ?? {}) as WeatherAtFlightArrivalParams,
      );
      let summary: string;
      if (!flightResult.arrivalAirport) {
        summary = flightResult.summary;
      } else {
        const weatherResult = await this.openMeteo.getWeatherForPlace(
          flightResult.arrivalAirport,
        );
        summary = `${flightResult.summary} Weather at arrival (${flightResult.arrivalAirport}): ${weatherResult.summary}`;
      }
      toolResultSummary = `TOOL_RESULT weather_at_flight_arrival: ${summary}`;
    } else {
      const reply = await requestNaturalLanguageReply(
        this.llmClient,
        userMessages,
        LLM_OPTS,
        MAX_MESSAGES,
      );
      return { reply };
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

