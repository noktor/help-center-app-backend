import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  FlightStatusParams,
  RouteWeatherParams,
  WeatherAtFlightArrivalParams,
} from '../tools/tool-action.types';

const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1';

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
   * Resolve city name to [lat, lon] using Open-Meteo geocoding API.
   */
  private async geocodeCity(cityName: string): Promise<[number, number] | null> {
    const name = cityName?.trim();
    if (!name) return null;
    const url = `${OPEN_METEO_GEOCODING_BASE}/search?name=${encodeURIComponent(name)}&count=1`;
    try {
      const res = await firstValueFrom(
        this.http.get<{
          results?: Array<{ latitude?: number; longitude?: number }>;
        }>(url),
      );
      const first = res.data?.results?.[0];
      if (first?.latitude != null && first?.longitude != null) {
        return [first.latitude, first.longitude];
      }
      return null;
    } catch (e) {
      this.logger.warn('Geocoding failed for city', name, (e as Error).message);
      return null;
    }
  }

  /**
   * Fetch flight status from aviationstack. flight_number should be IATA (e.g. UA2402).
   * When flight data is found, arrivalAirport is set for use by weather_at_flight_arrival.
   */
  async getFlightStatus(params: FlightStatusParams): Promise<{
    summary: string;
    raw?: unknown;
    arrivalAirport?: string;
  }> {
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
      const arrivalAirport = arr?.airport?.trim() || undefined;
      const summary = [
        `Flight ${flightIata} (${airline}): ${status}.`,
        dep?.airport ? `Departure: ${dep.airport} (${dep.iata ?? ''}) ${dep.scheduled ?? ''}.` : '',
        arr?.airport ? `Arrival: ${arr.airport} (${arr.iata ?? ''}) ${arr.scheduled ?? ''}.` : '',
      ]
        .filter(Boolean)
        .join(' ');

      return { summary, raw: first, arrivalAirport };
    } catch (e) {
      this.logger.error('getFlightStatus failed', e as Error);
      return {
        summary: 'Unable to fetch flight status. Please try again later.',
        raw: { error: String(e) },
      };
    }
  }

  /**
   * Fetch weather for origin and destination cities using Open-Meteo (geocoding + forecast, no API key).
   */
  async getRouteWeather(params: RouteWeatherParams): Promise<{ summary: string; raw?: unknown }> {
    const { origin_city, destination_city } = params;
    const originName = origin_city?.trim() ?? '';
    const destName = destination_city?.trim() ?? '';

    if (!originName) {
      return { summary: 'No origin city provided.' };
    }
    if (!destName) {
      return { summary: 'No destination city provided.' };
    }

    const [originCoords, destCoords] = await Promise.all([
      this.geocodeCity(originName),
      this.geocodeCity(destName),
    ]);

    if (!originCoords) {
      return {
        summary: `City not found: "${origin_city}". Please check the name and try again.`,
      };
    }
    if (!destCoords) {
      return {
        summary: `City not found: "${destination_city}". Please check the name and try again.`,
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

  /**
   * Hybrid: get flight status and weather at the arrival city (for questions like
   * "What temperature will it be at the arrival city of flight W61176?").
   */
  async getWeatherAtFlightArrival(
    params: WeatherAtFlightArrivalParams,
  ): Promise<{ summary: string; raw?: unknown }> {
    const flightResult = await this.getFlightStatus(params);
    if (!flightResult.arrivalAirport) {
      return {
        summary: flightResult.summary,
        raw: flightResult.raw,
      };
    }

    const placeForGeocode = flightResult.arrivalAirport;
    const coords = await this.geocodeCity(placeForGeocode);
    if (!coords) {
      return {
        summary: `${flightResult.summary} Could not resolve weather for arrival location "${placeForGeocode}".`,
        raw: flightResult.raw,
      };
    }

    try {
      const weatherStr = await this.fetchOpenMeteoCurrent(coords[0], coords[1]);
      const summary = `${flightResult.summary} Weather at arrival (${placeForGeocode}): ${weatherStr}`;
      return { summary, raw: { flight: flightResult.raw, weather: weatherStr } };
    } catch (e) {
      this.logger.warn('Weather at arrival failed', (e as Error).message);
      return {
        summary: `${flightResult.summary} Weather at arrival could not be fetched.`,
        raw: flightResult.raw,
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
