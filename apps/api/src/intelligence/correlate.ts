import type { HazardType, SeverityTier } from '@dn/shared';
import type { Sql } from 'postgres';
import { sql } from '../lib/db.js';
import { MONITORED_CITIES } from '../ingestion/config.js';
import {
  CITY_DENSITY,
  CITY_RADIUS_KM,
  CORRELATION,
  DEFAULT_DENSITY_IN_REGION,
  DEFAULT_DENSITY_OUTSIDE,
  MIN_H_TO_OPEN,
  REGION,
} from './config.js';
import { contributorH, scoreIncident, type Contributor } from './severity.js';

const LOCK_KEY = 72_001;
const OPEN_STATUSES = ['REPORTED', 'VERIFIED', 'ACTIVE'];

const point = (db: Sql, lon: number, lat: number) =>
  db`st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography`;

/** Serialises correlation so concurrent ingestion and report submissions can't create duplicate incidents. */
export function withCorrelationLock<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

const titleCase = (h: HazardType) => h.charAt(0) + h.slice(1).toLowerCase().replace(/_/g, ' ');

async function findOpenIncident(db: Sql, hazard: HazardType, lon: number, lat: number, at: Date) {
  const { radiusKm, windowHours } = CORRELATION[hazard];
  const [row] = await db<{ id: string }[]>`
    select id from public.incidents
    where hazard_type = ${hazard}
      and status in ${db(OPEN_STATUSES)}
      and st_dwithin(epicenter, ${point(db, lon, lat)}, ${radiusKm * 1000})
      and last_activity_at > ${at}::timestamptz - make_interval(hours => ${windowHours})
    order by st_distance(epicenter, ${point(db, lon, lat)})
    limit 1
  `;
  return row?.id ?? null;
}

async function createIncident(
  db: Sql,
  i: { hazard: HazardType; title: string; description: string | null; lon: number; lat: number; origin: 'feed' | 'citizen' },
) {
  const [row] = await db<{ id: string }[]>`
    insert into public.incidents (hazard_type, title, description, epicenter, origin)
    values (${i.hazard}, ${i.title}, ${i.description}, ${point(db, i.lon, i.lat)}, ${i.origin})
    returning id
  `;
  return row!.id;
}

interface SignalRow {
  id: string;
  source: string;
  hazard_type: HazardType;
  lon: number;
  lat: number;
  magnitude: number | null;
  title: string | null;
  occurred_at: Date;
  payload: Record<string, unknown>;
}

/** Attach new in-region feed signals to incidents. Returns the incidents touched. */
export async function correlateSignals(): Promise<{ linked: number; created: number; incidents: string[] }> {
  return withCorrelationLock(async (db) => {
    const signals = await db<SignalRow[]>`
      select id::text, source, hazard_type, st_x(location::geometry) as lon, st_y(location::geometry) as lat,
             magnitude::float8 as magnitude, title, occurred_at, payload
      from public.raw_signals
      where incident_id is null
        and st_intersects(location, st_makeenvelope(${REGION.minLon}, ${REGION.minLat},
                                                    ${REGION.maxLon}, ${REGION.maxLat}, 4326)::geography)
        and coalesce((payload ->> 'until')::timestamptz, occurred_at) > now() - interval '7 days'
      order by occurred_at
    `;

    const touched = new Set<string>();
    let linked = 0;
    let created = 0;

    for (const s of signals) {
      let incidentId = await findOpenIncident(db, s.hazard_type, s.lon, s.lat, s.occurred_at);
      if (!incidentId) {
        const { h } = contributorH({ kind: 'signal', ...s });
        if (h < (MIN_H_TO_OPEN[s.source] ?? MIN_H_TO_OPEN.default!)) continue;
        incidentId = await createIncident(db, {
          hazard: s.hazard_type,
          title: s.title ?? `${titleCase(s.hazard_type)} detected`,
          description: null,
          lon: s.lon,
          lat: s.lat,
          origin: 'feed',
        });
        created++;
      }
      await db`update public.raw_signals set incident_id = ${incidentId} where id = ${s.id}`;
      await db`update public.incidents set last_activity_at = now() where id = ${incidentId}`;
      touched.add(incidentId);
      linked++;
    }

    for (const id of touched) await recomputeIncident(db, id);
    return { linked, created, incidents: [...touched] };
  });
}

/** Attach one citizen report to an incident (creating one if needed). Call inside withCorrelationLock. */
export async function correlateReport(db: Sql, reportId: string): Promise<string> {
  const [r] = await db<{ hazard_type: HazardType; lon: number; lat: number; reported_at: Date; description: string | null; incident_id: string | null }[]>`
    select hazard_type, st_x(location::geometry) as lon, st_y(location::geometry) as lat,
           reported_at, description, incident_id
    from public.reports where id = ${reportId}
  `;
  if (!r) throw new Error(`Report ${reportId} not found`);
  if (r.incident_id) return r.incident_id;

  let incidentId = await findOpenIncident(db, r.hazard_type, r.lon, r.lat, r.reported_at);
  if (!incidentId) {
    incidentId = await createIncident(db, {
      hazard: r.hazard_type,
      title: `${titleCase(r.hazard_type)} reported by citizens`,
      description: r.description,
      lon: r.lon,
      lat: r.lat,
      origin: 'citizen',
    });
  }
  await db`update public.reports set incident_id = ${incidentId} where id = ${reportId}`;
  await db`update public.incidents set last_activity_at = now() where id = ${incidentId}`;
  await recomputeIncident(db, incidentId);
  return incidentId;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function populationDensity(lat: number, lon: number): { density: number; basis: string } {
  const nearest = MONITORED_CITIES
    .map((c) => ({ c, d: haversineKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearest && nearest.d <= CITY_RADIUS_KM) {
    return { density: CITY_DENSITY[nearest.c.id] ?? DEFAULT_DENSITY_IN_REGION, basis: `${nearest.c.name} city density` };
  }
  const inRegion = lon >= REGION.minLon && lon <= REGION.maxLon && lat >= REGION.minLat && lat <= REGION.maxLat;
  return inRegion
    ? { density: DEFAULT_DENSITY_IN_REGION, basis: `${REGION.name} national average` }
    : { density: DEFAULT_DENSITY_OUTSIDE, basis: 'world average (outside region)' };
}

/** Recompute epicenter, affected area, counts and severity for one incident. */
export async function recomputeIncident(db: Sql, incidentId: string): Promise<void> {
  const [inc] = await db<{ hazard_type: HazardType; verified: boolean; tier_override: SeverityTier | null }[]>`
    select hazard_type, verified_by is not null as verified, tier_override
    from public.incidents where id = ${incidentId}
  `;
  if (!inc) return;
  const radiusM = CORRELATION[inc.hazard_type].radiusKm * 1000;

  // Epicenter = centroid of all evidence; affected area = correlation radius around it.
  await db`
    update public.incidents i set epicenter = sub.c, affected_area = st_buffer(sub.c, ${radiusM})
    from (
      select st_centroid(st_collect(g))::geography as c from (
        select location::geometry as g from public.raw_signals where incident_id = ${incidentId}
        union all
        select location::geometry from public.reports where incident_id = ${incidentId}
      ) pts
    ) sub
    where i.id = ${incidentId} and sub.c is not null
      and (i.affected_area is null or not st_equals(i.epicenter::geometry, sub.c::geometry))
  `;

  const signals = await db<(SignalRow & { id: string })[]>`
    select id::text, source, hazard_type, st_x(location::geometry) as lon, st_y(location::geometry) as lat,
           magnitude::float8 as magnitude, title, occurred_at, payload
    from public.raw_signals where incident_id = ${incidentId}
  `;
  const reports = await db<{ id: string; hazard_type: HazardType; lon: number; reported_at: Date; has_photo: boolean; people_affected: number | null; trusted: boolean }[]>`
    select r.id, r.hazard_type, st_x(r.location::geometry) as lon, r.reported_at,
           r.photo_url is not null as has_photo, r.people_affected,
           exists (
             select 1 from public.reports r2
             join public.incidents i2 on i2.id = r2.incident_id
             where r2.user_id = r.user_id and r2.incident_id <> ${incidentId}
               and i2.verified_by is not null and i2.status <> 'REJECTED'
           ) as trusted
    from public.reports r where r.incident_id = ${incidentId}
  `;

  const contributors: Contributor[] = [
    ...signals.map((s): Contributor => ({ kind: 'signal', ...s })),
    ...reports.map((r): Contributor => ({
      kind: 'report',
      id: r.id,
      hazard_type: r.hazard_type,
      occurred_at: r.reported_at,
      lon: r.lon,
      has_photo: r.has_photo,
      reporter_trusted: r.trusted,
      people_affected: r.people_affected,
    })),
  ];

  const [geo] = await db<{ lat: number; lon: number; users: number }[]>`
    select st_y(i.epicenter::geometry) as lat, st_x(i.epicenter::geometry) as lon,
           (select count(*)::int from public.profiles p
            where p.last_location is not null and st_dwithin(p.last_location, i.epicenter, ${radiusM})) as users
    from public.incidents i where i.id = ${incidentId}
  `;
  const { density, basis } = populationDensity(geo!.lat, geo!.lon);

  const b = scoreIncident({
    hazard_type: inc.hazard_type,
    contributors,
    verified: inc.verified,
    tier_override: inc.tier_override,
    density_per_km2: density,
    density_basis: basis,
    users_in_area: geo!.users,
  });

  await db`
    update public.incidents set
      severity_score = ${b.score},
      severity_tier = ${b.tier},
      confidence = ${b.C},
      alert_permission = ${b.alert_permission},
      severity_breakdown = ${db.json(b as never)},
      signal_count = ${signals.length},
      report_count = ${reports.length}
    where id = ${incidentId}
      and (severity_breakdown is distinct from ${db.json(b as never)}
           or signal_count <> ${signals.length} or report_count <> ${reports.length})
  `;
}

/** Periodic refresh: picks up magnitude updates and changes in registered users nearby. */
export async function recomputeOpenIncidents(): Promise<number> {
  return withCorrelationLock(async (db) => {
    const rows = await db<{ id: string }[]>`
      select id from public.incidents where status in ${db(OPEN_STATUSES)}
    `;
    for (const r of rows) await recomputeIncident(db, r.id);
    return rows.length;
  });
}
