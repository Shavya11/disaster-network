import { Router } from 'express';
import { z } from 'zod';
import {
  SEVERITY_TIERS,
  createAlertSchema,
  previewAlertSchema,
  type Alert,
  type AlertDelivery,
  type AlertPreview,
  type InboxAlert,
  type SeverityTier,
} from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);
const staffOnly = requireRole('COORDINATOR', 'ADMIN');

/** Stops accidental state-wide broadcasts (report §9 C5, alert fatigue). */
const MAX_AREA_KM2 = 25_000;
/** A user gets at most one alert per incident per window unless the tier goes up. */
const DEDUP_WINDOW_MIN = 60;
/** Without a linked incident there is no verification trail, so only advisories are allowed. */
const MAX_TIER_WITHOUT_INCIDENT: SeverityTier = 'WATCH';

const rank = (t: SeverityTier) => SEVERITY_TIERS.indexOf(t);
const geofenceSql = (g: unknown) => sql`st_setsrid(st_geomfromgeojson(${JSON.stringify(g)}), 4326)`;

async function checkGeofence(g: unknown): Promise<number> {
  const [row] = await sql<{ valid: boolean; area_km2: number }[]>`
    select st_isvalid(${geofenceSql(g)}) as valid,
           round((st_area(${geofenceSql(g)}::geography) / 1e6)::numeric, 2)::float8 as area_km2
  `;
  if (!row!.valid) throw new HttpError(400, 'Geofence polygon is invalid (self-intersecting?)');
  if (row!.area_km2 > MAX_AREA_KM2) {
    throw new HttpError(400, `Geofence is ${row!.area_km2} km²; the maximum is ${MAX_AREA_KM2} km²`);
  }
  return row!.area_km2;
}

async function maxTierFor(incidentId: string | undefined): Promise<SeverityTier> {
  if (!incidentId) return MAX_TIER_WITHOUT_INCIDENT;
  const [inc] = await sql<{ status: string; alert_permission: SeverityTier }[]>`
    select status, alert_permission from public.incidents where id = ${incidentId}
  `;
  if (!inc) throw new HttpError(404, 'Incident not found');
  if (['REJECTED', 'RESOLVED'].includes(inc.status)) throw new HttpError(409, `Incident is ${inc.status}`);
  return inc.alert_permission;
}

const alertColumns = sql`
  a.id, a.incident_id, i.title as incident_title, a.tier, a.title, a.body,
  st_asgeojson(a.geofence)::json as geofence, a.channels, a.created_by, p.full_name as created_by_name,
  a.created_at, a.sent_at, a.recipient_count, a.skipped_duplicates,
  (select count(*)::int from public.deliveries d where d.alert_id = a.id and d.acknowledged_at is not null)
    as acknowledged_count
`;
const alertFrom = sql`
  from public.alerts a
  left join public.incidents i on i.id = a.incident_id
  left join public.profiles p on p.id = a.created_by
`;

async function loadAlert(id: string): Promise<Alert> {
  const [a] = await sql<Alert[]>`select ${alertColumns} ${alertFrom} where a.id = ${id}`;
  if (!a) throw new HttpError(404, 'Alert not found');
  return a;
}

// Live recipient count while the coordinator draws the area.
alertsRouter.post('/preview', staffOnly, async (req, res) => {
  const { geofence } = parse(previewAlertSchema, req.body);
  const incidentId = req.query.incident_id ? parse(z.string().uuid(), req.query.incident_id) : undefined;
  const area = await checkGeofence(geofence);
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.profiles p
    where p.last_location is not null and st_covers(${geofenceSql(geofence)}::geography, p.last_location)
  `;
  const preview: AlertPreview = { recipient_count: row!.n, area_km2: area, max_tier: await maxTierFor(incidentId) };
  res.json(preview);
});

alertsRouter.post('/', staffOnly, async (req, res) => {
  const input = parse(createAlertSchema, req.body);
  await checkGeofence(input.geofence);
  const maxTier = await maxTierFor(input.incident_id);
  if (rank(input.tier) > rank(maxTier)) {
    throw new HttpError(403, `This ${input.incident_id ? 'incident' : 'alert'} may be broadcast at ${maxTier} at most`, {
      max_tier: maxTier,
      hint: input.incident_id ? 'Verify the incident to allow higher tiers' : 'Link the alert to a verified incident',
    });
  }

  const alertId = await sql.begin(async (tx) => {
    const [alert] = await tx<{ id: string }[]>`
      insert into public.alerts (incident_id, tier, title, body, geofence, channels, created_by)
      values (${input.incident_id ?? null}, ${input.tier}, ${input.title}, ${input.body},
              ${geofenceSql(input.geofence)}::geography, ${['IN_APP']}, ${req.user!.id})
      returning id
    `;
    const id = alert!.id;

    const [counts] = await tx<{ total: number; delivered: number }[]>`
      with recipients as (
        select p.id from public.profiles p
        where p.last_location is not null
          and st_covers(${geofenceSql(input.geofence)}::geography, p.last_location)
      ),
      fresh as (
        select r.id from recipients r
        where ${input.incident_id ?? null}::uuid is null or not exists (
          select 1 from public.deliveries d join public.alerts a2 on a2.id = d.alert_id
          where d.user_id = r.id and a2.id <> ${id}
            and a2.incident_id = ${input.incident_id ?? null}::uuid
            and a2.created_at > now() - make_interval(mins => ${DEDUP_WINDOW_MIN})
            and a2.tier >= ${input.tier}::public.severity_tier
        )
      ),
      inserted as (
        insert into public.deliveries (alert_id, user_id, channel, status, attempts, sent_at)
        select ${id}, f.id, 'IN_APP', 'SENT', 1, now() from fresh f
        returning 1
      )
      select (select count(*)::int from recipients) as total, (select count(*)::int from inserted) as delivered
    `;
    await tx`
      update public.alerts set sent_at = now(), recipient_count = ${counts!.delivered},
        skipped_duplicates = ${counts!.total - counts!.delivered}
      where id = ${id}
    `;
    await audit(tx, {
      actorId: req.user!.id, action: 'ALERT_ISSUED', entityType: 'alert', entityId: id,
      after: { incident_id: input.incident_id ?? null, tier: input.tier, title: input.title, recipients: counts!.delivered },
    });
    return id;
  });
  res.status(201).json(await loadAlert(alertId));
});

const listQuery = z.object({ incident_id: z.string().uuid().optional() });

alertsRouter.get('/', staffOnly, async (req, res) => {
  const q = parse(listQuery, req.query);
  res.json(await sql<Alert[]>`
    select ${alertColumns} ${alertFrom}
    where 1 = 1 ${q.incident_id ? sql`and a.incident_id = ${q.incident_id}` : sql``}
    order by a.created_at desc limit 100
  `);
});

alertsRouter.get('/inbox', async (req, res) => {
  res.json(await sql<InboxAlert[]>`
    select a.id as alert_id, a.incident_id, a.tier, a.title, a.body,
           st_asgeojson(a.geofence)::json as geofence, d.sent_at as received_at, d.acknowledged_at
    from public.deliveries d join public.alerts a on a.id = d.alert_id
    where d.user_id = ${req.user!.id} and d.channel = 'IN_APP'
    order by d.created_at desc limit 50
  `);
});

alertsRouter.get('/:id', staffOnly, async (req, res) => {
  res.json(await loadAlert(parse(z.string().uuid(), req.params.id)));
});

alertsRouter.get('/:id/deliveries', staffOnly, async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  res.json(await sql<AlertDelivery[]>`
    select d.id::int as id, d.user_id, p.full_name as user_name, d.channel, d.status, d.sent_at, d.acknowledged_at
    from public.deliveries d join public.profiles p on p.id = d.user_id
    where d.alert_id = ${id}
    order by d.acknowledged_at is null, d.id
    limit 1000
  `);
});

alertsRouter.post('/:id/acknowledge', async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const rows = await sql`
    update public.deliveries set status = 'ACKNOWLEDGED', acknowledged_at = coalesce(acknowledged_at, now())
    where alert_id = ${id} and user_id = ${req.user!.id}
    returning id
  `;
  if (rows.count === 0) throw new HttpError(404, 'This alert was not sent to you');
  res.status(204).end();
});
