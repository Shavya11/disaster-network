import { REGION } from '../../intelligence/config.js';
import type { FeedAdapter, NormalizedSignal } from '../types.js';

// NASA FIRMS active fires (VIIRS S-NPP, near real time). Needs a free MAP_KEY:
// https://firms.modaps.eosdis.nasa.gov/api/map_key/
const PRODUCT = 'VIIRS_SNPP_NRT';

export function createFirmsAdapter(mapKey: string): FeedAdapter {
  return {
    source: 'firms',
    async fetch() {
      const bbox = `${REGION.minLon},${REGION.minLat},${REGION.maxLon},${REGION.maxLat}`;
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${PRODUCT}/${bbox}/1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from FIRMS`);
      const text = await res.text();
      if (!text.startsWith('latitude')) throw new Error(`Unexpected FIRMS response: ${text.slice(0, 100)}`);

      const [header, ...lines] = text.trim().split('\n');
      const cols = header!.split(',');
      const idx = (name: string) => cols.indexOf(name);
      const [iLat, iLon, iDate, iTime, iConf, iFrp, iDayNight] =
        ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp', 'daynight'].map(idx);

      const signals: NormalizedSignal[] = [];
      for (const line of lines) {
        const v = line.split(',');
        const confidence = v[iConf!];
        if (confidence === 'l') continue; // low-confidence detections are dropped
        const lat = Number(v[iLat!]);
        const lon = Number(v[iLon!]);
        const frp = Number(v[iFrp!]);
        const time = v[iTime!]!.padStart(4, '0');
        const date = v[iDate!]!;
        signals.push({
          source_event_id: `${lat.toFixed(4)},${lon.toFixed(4)},${date},${time}`,
          hazard_type: 'WILDFIRE',
          lat,
          lon,
          magnitude: Number.isFinite(frp) ? frp : null,
          title: `Satellite fire detection, ${frp} MW`,
          occurred_at: new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`),
          payload: { frp_mw: frp, confidence, daynight: v[iDayNight!], product: PRODUCT },
        });
      }
      return signals;
    },
  };
}
