import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { FlightStatusParams, RouteWeatherParams } from '../tools/tool-action.types';

/** Simple city name -> [lat, lon] for demo; extend as needed */
const CITY_COORDS: Record<string, [number, number]> = {
  barcelona: [41.3851, 2.1734],
  madrid: [40.4168, -3.7038],
  dublin: [53.3498, -6.2603],
  london: [51.5074, -0.1278],
  paris: [48.8566, 2.3522],
  amsterdam: [52.3676, 4.9041],
  rome: [41.9028, 12.4964],
  lisbon: [38.7223, -9.1393],
  newyork: [40.7128, -74.006],
  'new york': [40.7128, -74.006],
  losangeles: [34.0522, -118.2437],
  'los angeles': [34.0522, -118.2437],
};

function normalizeCity(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

@Injectable()
export class TravelDataService {
  private readonly logger = new Logger(TravelDataService.name);
  private readonly aviationKey: string;
  private readonly aviationBaseUrl: string;
  private readonly openMeteoBaseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aviationKey = this.config.get<string>('AVIATIONSTACK_API_KEY') ?? '';
    this.aviationBaseUrl =
      this.config.get<string>('AVIATIONSTACK_API_BASE_URL') ??
      'http://api.aviationstack.com/v1';
    this.openMeteoBaseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ??
      'https://api.open-meteo.com/v1';
  }

  /**
   * Fetch flight status from aviationstack. flight_number should be IATA (e.g. UA2402).
   */
  async getFlightStatus(params: FlightStatusParams): Promise<{ summary: string; raw?: unknown }> {
    const { flight_number, date } = params;
    if (!flight_number?.trim()) {
      return { summary: 'No flight number provided.' };
    }
    if (!this.aviationKey) {
      this.logger.warn('AVIATIONSTACK_API_KEY not set');
      return { summary: 'Flight data is not configured. Please try again later.' };
    }

    const flightIata = flight_number.trim().toUpperCase();
    const url = `${this.aviationBaseUrl}/flights`;
    const searchParams = new URLSearchParams({
      access_key: this.aviationKey,
      flight_iata: flightIata,
    });
    if (date) searchParams.set('flight_date', date);

    try {
      const res = await firstValueFrom(
        this.http.get<{
          data?: Array<{
            flight_status?: string;
            departure?: { airport?: string; iata?: string; scheduled?: string };
            arrival?: { airport?: string; iata?: string; scheduled?: string };
            airline?: { name?: string };
          }>;
          error?: { message?: string };
        }>(`${url}?${searchParams.toString()}`),
      );

      const err = res.data?.error;
      if (err?.message) {
        this.logger.warn('Aviationstack API error', err.message);
        return { summary: `Flight API error: ${err.message}`, raw: res.data };
      }

      const data = res.data?.data;
      if (!Array.isArray(data) || data.length === 0) {
        return {
          summary: `No flight data found for ${flightIata}${date ? ` on ${date}` : ''}.`,
          raw: res.data,
        };
      }

      const first = data[0];
      const status = first.flight_status ?? 'unknown';
      const dep = first.departure;
      const arr = first.arrival;
      const airline = first.airline?.name ?? 'Unknown airline';
      const summary = [
        `Flight ${flightIata} (${airline}): ${status}.`,
        dep?.airport ? `Departure: ${dep.airport} (${dep.iata ?? ''}) ${dep.scheduled ?? ''}.` : '',
        arr?.airport ? `Arrival: ${arr.airport} (${arr.iata ?? ''}) ${arr.scheduled ?? ''}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

      return { summary, raw: first };
    } catch (e) {
      this.logger.error('getFlightStatus failed', e as Error);
      return {
        summary: 'Unable to fetch flight status. Please try again later.',
        raw: { error: String(e) },
      };
    }
  }

  /**
   * Fetch weather for origin and destination cities using Open-Meteo (no API key).
   */
  async getRouteWeather(params: RouteWeatherParams): Promise<{ summary: string; raw?: unknown }> {
    const { origin_city, destination_city } = params;
    const originKey = normalizeCity(origin_city ?? '');
    const destKey = normalizeCity(destination_city ?? '');
    const originCoords = CITY_COORDS[originKey];
    const destCoords = CITY_COORDS[destKey];

    if (!originCoords) {
      return {
        summary: `Unknown origin city: "${origin_city}". Supported demo cities: Barcelona, Madrid, Dublin, London, Paris, Amsterdam, Rome, Lisbon, New York, Los Angeles.`,
      };
    }
    if (!destCoords) {
      return {
        summary: `Unknown destination city: "${destination_city}". Supported demo cities: Barcelona, Madrid, Dublin, London, Paris, Amsterdam, Rome, Lisbon, New York, Los Angeles.`,
      };
    }

    try {
      const [originWeather, destWeather] = await Promise.all([
        this.fetchOpenMeteoCurrent(originCoords[0], originCoords[1]),
        this.fetchOpenMeteoCurrent(destCoords[0], destCoords[1]),
      ]);

      const summary = [
        `${origin_city}: ${originWeather}.`,
        `${destination_city}: ${destWeather}.`,
      ].join(' ');

      return { summary, raw: { origin: originWeather, destination: destWeather } };
    } catch (e) {
      this.logger.error('getRouteWeather failed', e as Error);
      return {
        summary: 'Unable to fetch weather for the route. Please try again later.',
        raw: { error: String(e) },
      };
    }
  }

  private async fetchOpenMeteoCurrent(lat: number, lon: number): Promise<string> {
    const url = `${this.openMeteoBaseUrl}/forecast`;
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    });

    const res = await firstValueFrom(
      this.http.get<{
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          wind_speed_10m?: number;
          weather_code?: number;
        };
      }>(`${url}?${params.toString()}`),
    );

    const c = res.data?.current;
    if (!c) return 'No current weather data';
    const temp = c.temperature_2m ?? 0;
    const humidity = c.relative_humidity_2m ?? 0;
    const wind = c.wind_speed_10m ?? 0;
    return `${temp}°C, ${humidity}% humidity, wind ${wind} km/h`;
  }
}
