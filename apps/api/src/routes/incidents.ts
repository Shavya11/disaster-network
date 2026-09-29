import { Router } from 'express';
import { z } from 'zod';
import {
  listIncidentsQuerySchema,
  rejectIncidentSchema,
  updateIncidentSchema,
  updateIncidentStatusSchema,
  verifyIncidentSchema,
  type Incident,
  type IncidentStatus,
  type Report,
  type Signal,
} from '@dn/shared';
import type { Sql } from 'postgres';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { recomputeIncident, withCorrelationLock } from '../intelligence/correlate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { reportColumns } from './reports.js';

export const incidentsRouter = Router();

const incidentColumns = sql`
  i.id, i.hazard_type, i.title, i.description, i.status,
  i.severity_score::float8 as severity_score, i.severity_tier,
  json_build_object('lat', st_y(i.epicenter::geometry), 'lon', st_x(i.epicenter::geometry)) as epicenter,
  st_asgeojson(i.affected_area)::json as affected_area,
  i.report_count, i.signal_count, i.confidence::float8 as confidence,
  i.alert_permission, i.severity_breakdown, i.origin,
  i.verified_by, i.verified_at, i.last_activity_at, i.created_at, i.updated_at, i.resolved_at
`;

async function loadIncident(id: string): Promise<Incident> {
  const [row] = await sql<Incident[]>`select ${incidentColumns} from public.incidents i where i.id = ${id}`;
  if (!row) throw new HttpError(404, 'Incident not found');
  return row;
}

const idParam = (raw: unknown) => parse(z.string().uuid(), raw);

// Public: the map is visible without login. Rejected incidents are hidden.
incidentsRouter.get('/', async (req, res) => {
  const q = parse(listIncidentsQuerySchema, req.query);
  const bbox = q.bbox;

  const rows = await sql<Incident[]>`
    select ${incidentColumns}
    from public.incidents i
    where 1 = 1
      ${q.status ? sql`and i.status = ${q.status}` : sql`and i.status <> 'REJECTED'`}
      ${q.hazard ? sql`and i.hazard_type = ${q.hazard}` : sql``}
      ${q.since ? sql`and i.last_activity_at >= ${q.since}` : sql``}
      ${bbox
        ? sql`and st_intersects(i.epicenter,
                st_makeenvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)::geography)`
        : sql``}
    order by i.severity_score desc, i.last_activity_at desc
    limit ${q.limit}
  `;
  res.json(rows);
});

incidentsRouter.get('/:id', async (req, res) => {
  res.json(await loadIncident(idParam(req.params.id)));
});

incidentsRouter.get('/:id/signals', async (req, res) => {
  const rows = await sql<Signal[]>`
    select s.id::int as id, s.source, s.source_event_id, s.hazard_type,
      json_build_object('lat', st_y(s.location::geometry), 'lon', st_x(s.location::geometry)) as location,
      s.magnitude::float8 as magnitude, s.title, s.occurred_at, s.payload, s.incident_id
    from public.raw_signals s where s.incident_id = ${idParam(req.params.id)}
    order by s.occurred_at desc
  `;
  res.json(rows);
});

incidentsRouter.get(
  '/:id/reports',
  requireAuth,
  requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'),
  async (req, res) => {
    const rows = await sql<Report[]>`
      select ${reportColumns} from public.reports r
      where r.incident_id = ${idParam(req.params.id)}
      order by r.reported_at desc
    `;
    res.json(rows);
  },
);

// ---- Coordinator actions. Every change is audited.

const staff = [requireAuth, requireRole('COORDINATOR', 'ADMIN')];

type Snapshot = { status: IncidentStatus; severity_tier: string; severity_score: number; tier_override: string | null; title: string };

async function lockIncident(db: Sql, id: string): Promise<Snapshot> {
  const [row] = await db<Snapshot[]>`
    select status, severity_tier, severity_score::float8 as severity_score, tier_override, title
    from public.incidents where id = ${id} for update
  `;
  if (!row) throw new HttpError(404, 'Incident not found');
  return row;
}


incidentsRouter.post('/:id/verify', ...staff, async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(verifyIncidentSchema, req.body);

  await withCorrelationLock(async (db) => {
    const before = await lockIncident(db, id);
    if (before.status !== 'REPORTED') {
      throw new HttpError(409, `Only REPORTED incidents can be verified (current: ${before.status})`);
    }
    await db`
      update public.incidents set
        status = 'VERIFIED', verified_by = ${req.user!.id}, verified_at = now(),
        tier_override = ${input.tier ?? null}
      where id = ${id}
    `;
    await recomputeIncident(db, id);
    await audit(db, {
      actorId: req.user!.id, action: 'INCIDENT_VERIFIED', entityType: 'incident', entityId: id,
      before, after: { ...(await lockIncident(db, id)), note: input.note ?? null },
    });
  });
  res.json(await loadIncident(id));
});

incidentsRouter.post('/:id/reject', ...staff, async (req, res) => {
  const id = idParam(req.params.id);
  const { reason } = parse(rejectIncidentSchema, req.body);

  await withCorrelationLock(async (db) => {
    const before = await lockIncident(db, id);
    if (!['REPORTED', 'VERIFIED', 'ACTIVE'].includes(before.status)) {
      throw new HttpError(409, `Cannot reject an incident that is ${before.status}`);
    }
    await db`update public.incidents set status = 'REJECTED' where id = ${id}`;
    await audit(db, {
      actorId: req.user!.id, action: 'INCIDENT_REJECTED', entityType: 'incident', entityId: id,
      before, after: { ...(await lockIncident(db, id)), reason },
    });
  });
  res.json(await loadIncident(id));
});

// Lifecycle after verification. REPORTED is only reachable from REJECTED (undo a rejection).
const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  REPORTED: [],
  VERIFIED: ['ACTIVE', 'CONTAINED', 'RESOLVED'],
  ACTIVE: ['CONTAINED', 'RESOLVED'],
  CONTAINED: ['ACTIVE', 'RESOLVED'],
  RESOLVED: ['ACTIVE'],
  REJECTED: ['REPORTED'],
};

incidentsRouter.patch('/:id/status', ...staff, async (req, res) => {
  const id = idParam(req.params.id);
  const { status, note } = parse(updateIncidentStatusSchema, req.body);

  await withCorrelationLock(async (db) => {
    const before = await lockIncident(db, id);
    if (!TRANSITIONS[before.status].includes(status)) {
      throw new HttpError(409, `Cannot move from ${before.status} to ${status}`, {
        allowed: TRANSITIONS[before.status],
      });
    }
    await db`
      update public.incidents set
        status = ${status},
        resolved_at = ${status === 'RESOLVED' ? db`now()` : null},
        last_activity_at = now()
      where id = ${id}
    `;
    await audit(db, {
      actorId: req.user!.id, action: 'INCIDENT_STATUS_CHANGED', entityType: 'incident', entityId: id,
      before, after: { ...(await lockIncident(db, id)), note: note ?? null },
    });
  });
  res.json(await loadIncident(id));
});

incidentsRouter.patch('/:id', ...staff, async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(updateIncidentSchema, req.body);

  await withCorrelationLock(async (db) => {
    const before = await lockIncident(db, id);
    const changes: Record<string, unknown> = {};
    if (input.title !== undefined) changes.title = input.title;
    if (input.description !== undefined) changes.description = input.description;
    if (input.tier !== undefined) changes.tier_override = input.tier;
    if (Object.keys(changes).length === 0) return;

    await db`update public.incidents set ${db(changes)} where id = ${id}`;
    if (input.tier !== undefined) await recomputeIncident(db, id);
    await audit(db, {
      actorId: req.user!.id, action: 'INCIDENT_UPDATED', entityType: 'incident', entityId: id,
      before, after: await lockIncident(db, id),
    });
  });
  res.json(await loadIncident(id));
});
