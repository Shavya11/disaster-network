import type { HazardType } from '@dn/shared';

export interface NormalizedSignal {
  source_event_id: string;
  hazard_type: HazardType;
  lat: number;
  lon: number;
  magnitude: number | null;
  title: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
}

export interface FeedAdapter {
  source: string;
  fetch(): Promise<NormalizedSignal[]>;
}

const USER_AGENT = 'disaster-network/0.1 (student project)';

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
