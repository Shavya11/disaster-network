import type { LatLon, RouteResult } from '@dn/shared';
import { sql } from '../lib/db.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
/** Route passing within this distance of a closure counts as using it. */
const CLOSURE_BUFFER_M = 20;
/** Detour via-points are placed this far from the closure centre. */
const DETOUR_OFFSETS_KM = [1.5, 3];

interface Candidate {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distance: number;
  duration: number;
}

async function osrm(points: LatLon[], alternatives: boolean): Promise<Candidate[]> {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives ? 3 : 'false'}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'disaster-network/0.1 (student project)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Routing service returned HTTP ${res.status}`);
  const body = (await res.json()) as { code: string; routes?: Candidate[] };
  return body.code === 'Ok' ? body.routes ?? [] : [];
}

async function closuresCrossed(route: Candidate): Promise<{ id: string; lat: number; lon: number }[]> {
  return sql<{ id: string; lat: number; lon: number }[]>`
    select b.id,
      st_y(st_centroid(b.segment::geometry)) as lat,
      st_x(st_centroid(b.segment::geometry)) as lon
    from public.blocked_roads b
    where b.active
      and st_dwithin(b.segment, st_geomfromgeojson(${JSON.stringify(route.geometry)})::geography, ${CLOSURE_BUFFER_M})
  `;
}

const toResult = (r: Candidate | undefined, blocked: boolean, crosses: string[], checked: number): RouteResult => ({
  geometry: r?.geometry ?? null,
  distance_km: r ? Math.round(r.distance / 10) / 100 : null,
  duration_min: r ? Math.round(r.duration / 6) / 10 : null,
  blocked,
  crosses_closures: crosses,
  alternatives_checked: checked,
  provider: 'OSRM (OpenStreetMap)',
});

/** Shortest route that avoids every active closure, or the best available route flagged as blocked. */
export async function findRoute(from: LatLon, to: LatLon): Promise<RouteResult> {
  const direct = await osrm([from, to], true);
  if (direct.length === 0) return toResult(undefined, true, [], 0);

  let checked = 0;
  let firstClosure: { lat: number; lon: number } | null = null;
  for (const r of direct) {
    checked++;
    const crossed = await closuresCrossed(r);
    if (crossed.length === 0) return toResult(r, false, [], checked);
    firstClosure ??= crossed[0]!;
  }

  // Every alternative hits a closure: force detours through points around it.
  const c = firstClosure!;
  const kmToDeg = (km: number) => km / 111;
  const vias: LatLon[] = DETOUR_OFFSETS_KM.flatMap((km) => [
    { lat: c.lat + kmToDeg(km), lon: c.lon },
    { lat: c.lat - kmToDeg(km), lon: c.lon },
    { lat: c.lat, lon: c.lon + kmToDeg(km) / Math.cos((c.lat * Math.PI) / 180) },
    { lat: c.lat, lon: c.lon - kmToDeg(km) / Math.cos((c.lat * Math.PI) / 180) },
  ]);

  const clear: Candidate[] = [];
  for (const via of vias) {
    const [r] = await osrm([from, via, to], false);
    if (!r) continue;
    checked++;
    if ((await closuresCrossed(r)).length === 0) clear.push(r);
    if (clear.length >= 2) break;
  }
  if (clear.length) {
    clear.sort((a, b) => a.duration - b.duration);
    return toResult(clear[0], false, [], checked);
  }

  const fallback = direct[0]!;
  const crosses = (await closuresCrossed(fallback)).map((x) => x.id);
  return toResult(fallback, true, crosses, checked);
}
