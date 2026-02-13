/**
 * Contract for LLM tool-calling: the model may respond with this JSON
 * when it needs live flight or weather data. Nest parses it and executes
 * the corresponding API calls, then sends results back for a final natural reply.
 *
 * Implementation note (industry standard vs current approach):
 * - Industry standard is native tool/function calling: the provider API (OpenAI tools,
 *   Gemini functionDeclarations) returns structured tool_calls with name + arguments;
 *   the app runs the function and sends the result back; no JSON is ever in user-facing text.
 * - Here we use prompt-based tool selection: the system prompt asks the model to output
 *   this JSON shape when it needs live data. We parse/extract it from the reply and
 *   strip any tool JSON before showing the reply to the user. This is a workaround so we
 *   can support generic chat APIs (e.g. FreeFlow) that do not expose native tool calling.
 *   For a production system with OpenAI or Gemini, prefer migrating to native tools.
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

function tryParseToolAction(jsonStr: string): ToolAction | null {
  const s = jsonStr.trim();
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && 'action' in parsed) {
      const action = (parsed as { action: string }).action;
      if (TOOL_ACTION_IDS.includes(action as ToolActionId)) {
        return parsed as ToolAction;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Removes any tool-call JSON from the reply so it is never shown to the user.
 * Part of the prompt-based workaround (see file header); not needed with native tool calling.
 * Removes all occurrences and cleans leftover markdown code fences (```).
 *
 * NOTE: this is intentionally "brutal" — anything that looks like our
 * {"action": "...", "params": {...}} tool JSON gets stripped out so users
 * never see raw JSON, even if the model ignores instructions.
 */
export function stripToolJsonFromReply(reply: string): string {
  // 1) Quick exit if there's clearly no tool JSON
  if (!reply.includes('action')) return reply.trim();

  // 2) Normalise smart/curly quotes to plain ASCII so regex is stable
  const normalized = reply
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'");

  let t = normalized;

  // 3) Brutal regex: strip anything that looks like our tool JSON, even across newlines.
  //    - Allow optional bullet ('*', '-', '•') and spaces before the JSON.
  //    - Use [\s\S]*? to match params body lazily, we don't care if it's perfect JSON,
  //      we just want it gone from user-facing text.
  const toolJsonPattern =
    /[^\S\r\n]*[\*\-•]?\s*\{\s*"action"\s*:\s*"(?:flight_status|route_weather|weather_at_flight_arrival|none)"[\s\S]*?\}\s*/g;

  let prev: string;
  do {
    prev = t;
    t = t.replace(toolJsonPattern, ' ').trim();
  } while (t !== prev);

  // 4) Remove leftover markdown code blocks (e.g. ```json or ``` around where JSON was)
  t = t.replace(/\s*```(?:json)?\s*\n?\s*```\s*/g, '').trim();
  t = t.replace(/\s*```(?:json)?\s*$/g, '').trim();
  t = t.replace(/^\s*```(?:json)?\s*\n?/g, '').trim();

  // 5) Collapse multiple spaces and clean up bullet-only lines
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[^\S\r\n]*[\*\-•]+\s*$/gm, '').trim();
  t = t.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  // 6) Fallback to original trimmed reply if somehow we blanked everything
  return t || reply.trim();
}

/** Parses or extracts tool action from LLM reply (prompt-based workaround; see file header). */
export function parseToolAction(raw: string): ToolAction | null {
  const trimmed = raw.trim();
  // Try whole string first (LLM replied with only JSON)
  let result = tryParseToolAction(trimmed);
  if (result !== null) return result;
  if (!trimmed.includes('"action"')) return null;
  // Try to extract a JSON object from the string (e.g. text + JSON at the end)
  for (let start = trimmed.lastIndexOf('{'); start !== -1; start = trimmed.lastIndexOf('{', start - 1)) {
    let depth = 0;
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          result = tryParseToolAction(trimmed.slice(start, i + 1));
          if (result !== null) return result;
          break;
        }
      }
    }
    if (start <= 0) break;
  }
  return null;
}
