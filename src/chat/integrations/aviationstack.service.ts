import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { FlightStatusParams } from '../tools/tool-action.types';

@Injectable()
export class AviationstackService {
  private readonly logger = new Logger(AviationstackService.name);
  private readonly aviationKey: string;
  private readonly aviationBaseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.aviationKey = this.config.get<string>('AVIATIONSTACK_API_KEY') ?? '';
    this.aviationBaseUrl =
      this.config.get<string>('AVIATIONSTACK_API_BASE_URL') ??
      'https://api.aviationstack.com/v1';
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
    // Free tier does NOT support flight_date - it returns 403. Only add date on paid plans.
    const skipDate = this.config.get<string>('AVIATIONSTACK_SKIP_DATE') !== 'false';
    if (date && !skipDate) searchParams.set('flight_date', date);

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
        dep?.airport
          ? `Departure: ${dep.airport} (${dep.iata ?? ''}) ${dep.scheduled ?? ''}.`
          : '',
        arr?.airport
          ? `Arrival: ${arr.airport} (${arr.iata ?? ''}) ${arr.scheduled ?? ''}.`
          : '',
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
}

