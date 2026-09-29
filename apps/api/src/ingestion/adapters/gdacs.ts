import type { HazardType } from '@dn/shared';
import { fetchJson, type FeedAdapter, type NormalizedSignal } from '../types.js';

const BASE = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const LOOKBACK_DAYS = 3;

// Earthquakes are left to USGS, which is faster and more precise.
const TYPE_MAP: Record<string, HazardType> = {
  TC: 'CYCLONE',
  FL: 'FLOOD',
  WF: 'WILDFIRE',
  DR: 'OTHER',
  VO: 'OTHER',
};

interface GdacsFeed {
  features: {
    geometry: { type: string; coordinates: [number, number] };
    properties: {
      eventtype: string;
      eventid: number;
      episodeid: number;
      name: string;
      htmldescription: string;
      alertlevel: 'Green' | 'Orange' | 'Red';
      alertscore: number;
      country: string;
      fromdate: string;
      todate: string;
      iscurrent: string;
      url: { report: string };
      severitydata?: { severity: number; severitytext: string; severityunit: string };
    };
  }[];
}

export const gdacsAdapter: FeedAdapter = {
  source: 'gdacs',
  async fetch() {
    const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    // The same event appears once per episode; keep only the latest episode.
    const byEvent = new Map<string, NormalizedSignal & { episode: number }>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `${BASE}?eventlist=${Object.keys(TYPE_MAP).join(';')}` +
        `&alertlevel=Green;Orange;Red&fromdate=${from}&pagenumber=${page}`;
      const feed = await fetchJson<GdacsFeed | null>(url);
      const features = feed?.features ?? [];

      for (const f of features) {
        const p = f.properties;
        const hazard = TYPE_MAP[p.eventtype];
        if (!hazard || f.geometry.type !== 'Point') continue;
        const [lon, lat] = f.geometry.coordinates;
        const id = `${p.eventtype}-${p.eventid}`;
        const existing = byEvent.get(id);
        if (existing && existing.episode >= p.episodeid) continue;
        byEvent.set(id, {
          episode: p.episodeid,
          source_event_id: id,
          hazard_type: hazard,
          lat,
          lon,
          magnitude: p.severitydata?.severity ?? null,
          title: p.name,
          // GDACS timestamps are UTC without a zone suffix.
          occurred_at: new Date(`${p.fromdate}Z`),
          payload: {
            gdacs_type: p.eventtype,
            episode_id: p.episodeid,
            alert_level: p.alertlevel,
            alert_score: p.alertscore,
            country: p.country,
            severity_text: p.severitydata?.severitytext ?? null,
            severity_unit: p.severitydata?.severityunit ?? null,
            until: `${p.todate}Z`,
            is_current: p.iscurrent === 'true',
            report_url: p.url.report,
          },
        });
      }
      if (features.length < PAGE_SIZE) break;
    }
    return [...byEvent.values()].map(({ episode: _episode, ...signal }) => signal);
  },
};
