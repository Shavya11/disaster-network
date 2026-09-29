import type { HazardType } from '@dn/shared';
import { MONITORED_CITIES, WEATHER_THRESHOLDS as T } from '../config.js';
import { fetchJson, type FeedAdapter, type NormalizedSignal } from '../types.js';

interface OpenMeteoDaily {
  daily: {
    time: string[];
    precipitation_sum: (number | null)[];
    wind_gusts_10m_max: (number | null)[];
    temperature_2m_max: (number | null)[];
  };
}

// Open-Meteo gives forecasts, not events: a signal is emitted only when a
// forecast day crosses a threshold. One row per city + day + hazard.
export const openMeteoAdapter: FeedAdapter = {
  source: 'open-meteo',
  async fetch() {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${MONITORED_CITIES.map((c) => c.lat).join(',')}` +
      `&longitude=${MONITORED_CITIES.map((c) => c.lon).join(',')}` +
      '&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_max' +
      '&forecast_days=3&timezone=Asia%2FKolkata';

    const data = await fetchJson<OpenMeteoDaily | OpenMeteoDaily[]>(url);
    const locations = Array.isArray(data) ? data : [data];
    const signals: NormalizedSignal[] = [];

    locations.forEach((loc, i) => {
      const city = MONITORED_CITIES[i]!;
      loc.daily.time.forEach((date, d) => {
        const checks: [HazardType, number | null | undefined, number, string, string][] = [
          ['FLOOD', loc.daily.precipitation_sum[d], T.heavyRainMm, 'mm', 'Heavy rain'],
          ['STORM', loc.daily.wind_gusts_10m_max[d], T.galeGustKmh, 'km/h', 'Gale-force winds'],
          ['HEATWAVE', loc.daily.temperature_2m_max[d], T.heatwaveMaxC, '°C', 'Heatwave'],
        ];
        for (const [hazard, value, threshold, unit, label] of checks) {
          if (value == null || value < threshold) continue;
          signals.push({
            source_event_id: `${city.id}:${date}:${hazard}`,
            hazard_type: hazard,
            lat: city.lat,
            lon: city.lon,
            magnitude: value,
            title: `${label} forecast in ${city.name} on ${date}: ${value} ${unit}`,
            occurred_at: new Date(`${date}T00:00:00+05:30`),
            payload: { city: city.name, forecast_date: date, value, unit, threshold },
          });
        }
      });
    });
    return signals;
  },
};
