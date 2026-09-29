import { fetchJson, type FeedAdapter, type NormalizedSignal } from '../types.js';

const URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

interface UsgsFeed {
  features: {
    id: string;
    properties: {
      mag: number | null;
      place: string | null;
      time: number;
      url: string;
      title: string;
      tsunami: number;
      alert: string | null;
      sig: number;
      magType: string;
      status: string;
    };
    geometry: { coordinates: [number, number, number] };
  }[];
}

export const usgsAdapter: FeedAdapter = {
  source: 'usgs',
  async fetch() {
    const feed = await fetchJson<UsgsFeed>(URL);
    return feed.features.map((f): NormalizedSignal => {
      const [lon, lat, depth] = f.geometry.coordinates;
      const p = f.properties;
      return {
        source_event_id: f.id,
        hazard_type: 'EARTHQUAKE',
        lat,
        lon,
        magnitude: p.mag,
        title: p.title,
        occurred_at: new Date(p.time),
        payload: {
          place: p.place,
          url: p.url,
          depth_km: depth,
          tsunami: p.tsunami === 1,
          pager_alert: p.alert,
          significance: p.sig,
          mag_type: p.magType,
          review_status: p.status,
        },
      };
    });
  },
};
