import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { RouteWeatherParams } from '../tools/tool-action.types';

const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1';

@Injectable()
export class OpenMeteoService {
  private readonly logger = new Logger(OpenMeteoService.name);
  private readonly openMeteoBaseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
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
    const url = `${OPEN_METEO_GEOCODING_BASE}/search?name=${encodeURIComponent(
      name,
    )}&count=1`;
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

  /**
   * Fetch weather for origin and destination cities using Open-Meteo (geocoding + forecast, no API key).
   */
  async getRouteWeather(
    params: RouteWeatherParams,
  ): Promise<{ summary: string; raw?: unknown }> {
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
   * Get current weather for a single place (used for weather_at_flight_arrival).
   */
  async getWeatherForPlace(placeName: string): Promise<{ summary: string }> {
    const name = placeName?.trim() ?? '';
    if (!name) {
      return { summary: 'No place name provided.' };
    }

    const coords = await this.geocodeCity(name);
    if (!coords) {
      return {
        summary: `Place not found: "${placeName}". Please check the name and try again.`,
      };
    }

    try {
      const summary = await this.fetchOpenMeteoCurrent(coords[0], coords[1]);
      return { summary };
    } catch (e) {
      this.logger.warn('getWeatherForPlace failed', (e as Error).message);
      return { summary: 'Weather could not be fetched for this place.' };
    }
  }
}

