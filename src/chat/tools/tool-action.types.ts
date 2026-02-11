/**
 * Contract for LLM tool-calling: the model may respond with this JSON
 * when it needs live flight or weather data. Nest parses it and executes
 * the corresponding API calls, then sends results back for a final natural reply.
 */
export type ToolActionId =
  | 'flight_status'
  | 'route_weather'
  | 'weather_at_flight_arrival'
  | 'none';

export interface FlightStatusParams {
  flight_number: string;
  date?: string;
}

export interface RouteWeatherParams {
  origin_city: string;
  destination_city: string;
  departure_time?: string;
}

/** Same params as flight_status: we fetch the flight then weather at arrival city */
export interface WeatherAtFlightArrivalParams {
  flight_number: string;
  date?: string;
}

export type ToolParams =
  | FlightStatusParams
  | RouteWeatherParams
  | WeatherAtFlightArrivalParams
  | Record<string, never>;

export interface ToolAction {
  action: ToolActionId;
  params?: ToolParams;
}

const TOOL_ACTION_IDS: ToolActionId[] = [
  'flight_status',
  'route_weather',
  'weather_at_flight_arrival',
  'none',
];

export function parseToolAction(raw: string): ToolAction | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && 'action' in parsed) {
      const action = (parsed as { action: string }).action;
      if (TOOL_ACTION_IDS.includes(action as ToolActionId)) {
        return parsed as ToolAction;
      }
    }
  } catch {
    // not valid JSON or wrong shape
  }
  return null;
}
