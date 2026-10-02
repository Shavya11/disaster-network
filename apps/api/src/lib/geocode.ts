// Reverse geocoding via OpenStreetMap Nominatim (free, max 1 request/second, results cached).
import type { HazardType } from '@dn/shared';
import { MONITORED_CITIES } from '../ingestion/config.js';
import { CORRELATION } from '../intelligence/config.js';
import { sql } from './db.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1100;
const BATCH = 20;

let lastCall = 0;
let running = false;

const gridKey = (lat: number, lon: number, coarse: boolean) =>
  coarse ? `d:${lat.toFixed(1)},${lon.toFixed(1)}` : `${lat.toFixed(2)},${lon.toFixed(2)}`;

interface NominatimAddress {
  suburb?: string; neighbourhood?: string; city_district?: string; city?: string; town?: string;
  village?: string; county?: string; state_district?: string; state?: string; country?: string;
}

/** Wide-area hazards get 'District, State'; local ones get 'Neighbourhood, City'. */
function formatPlace(a: NominatimAddress, coarse: boolean): string | null {
  if (coarse) {
    const parts = [a.state_district ?? a.county ?? a.city ?? a.town, a.state]
      .filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
    if (a.country && a.country !== 'India') parts.push(a.country);
    return parts.length ? parts.join(', ') : a.country ?? null;
  }
  const local = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.village;
  const city = a.city ?? a.town ?? a.county ?? a.state_district;
  const parts = [local, city].filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
  if (parts.length === 0) return a.state ?? a.country ?? null;
  // Outside India, say which country it is.
  if (a.country && a.country !== 'India') parts.push(a.country);
  return parts.join(', ');
}

async function lookup(lat: number, lon: number, coarse: boolean): Promise<string | null> {
  const key = gridKey(lat, lon, coarse);
  const [cached] = await sql<{ place_name: string | null }[]>`
    select place_name from public.geocode_cache where grid_key = ${key}
  `;
  if (cached) return cached.place_name;

  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const res = await fetch(`${NOMINATIM}?format=jsonv2&zoom=${coarse ? 8 : 14}&accept-language=en&lat=${lat}&lon=${lon}`, {
    headers: { 'User-Agent': 'rakshak-disaster-network/0.1 (student project)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const body = (await res.json()) as { address?: NominatimAddress; error?: string };
  const name = body.address ? formatPlace(body.address, coarse) : null;
  await sql`
    insert into public.geocode_cache (grid_key, place_name) values (${key}, ${name})
    on conflict (grid_key) do nothing
  `;
  return name;
}

function nearestCityFallback(lat: number, lon: number): string | null {
  let best: { name: string; d: number } | null = null;
  for (const c of MONITORED_CITIES) {
    const d = Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos((lat * Math.PI) / 180)) * 111;
    if (!best || d < best.d) best = { name: c.name, d };
  }
  return best && best.d < 30 ? `near ${best.name}` : null;
}

/** Fill place names for incidents that don't have one yet. Safe to call often; never runs twice at once. */
export async function fillPlaceNames(): Promise<number> {
  if (running) return 0;
  running = true;
  let filled = 0;
  try {
    const rows = await sql<{ id: string; hazard_type: HazardType; lat: number; lon: number; country: string | null }[]>`
      select i.id, i.hazard_type, st_y(i.epicenter::geometry) as lat, st_x(i.epicenter::geometry) as lon,
        (select s.payload ->> 'country' from public.raw_signals s
         where s.incident_id = i.id and s.payload ? 'country' limit 1) as country
      from public.incidents i
      where i.place_name is null
      order by i.created_at desc
      limit ${BATCH}
    `;
    for (const r of rows) {
      let name: string | null = null;
      try {
        // GDACS events (they carry a country) are regional even when the hazard type is local.
        name = await lookup(r.lat, r.lon, CORRELATION[r.hazard_type].radiusKm >= 25 || r.country != null);
      } catch (err) {
        console.warn(`Geocoding failed for incident ${r.id}: ${(err as Error).message}`);
      }
      name ??= r.country ?? nearestCityFallback(r.lat, r.lon) ?? `${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`;
      await sql`update public.incidents set place_name = ${name} where id = ${r.id}`;
      filled++;
    }
  } finally {
    running = false;
  }
  return filled;
}

/** Fire-and-forget variant for request handlers. */
export function fillPlaceNamesSoon() {
  setTimeout(() => fillPlaceNames().catch((err) => console.error('fillPlaceNames', err)), 0);
}
