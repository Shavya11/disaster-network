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
  type IncidentTimelineEvent,
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
  i.id, 'INC-' || i.ref_no as reference, i.place_name, i.hazard_type, i.title, i.description, i.status,
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

// Human-readable history for the incident detail panel.
incidentsRouter.get(
  '/:id/timeline',
  requireAuth,
  requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'),
  async (req, res) => {
    const id = idParam(req.params.id);
    const [inc] = await sql<{ created_at: Date; origin: string }[]>`
      select created_at, origin from public.incidents where id = ${id}`;
    if (!inc) throw new HttpError(404, 'Incident not found');

    const [signals, reports, audits, alerts, allocations, closures] = await Promise.all([
      sql<{ at: Date; source: string; title: string | null }[]>`
        select ingested_at as at, source, title from public.raw_signals where incident_id = ${id}`,
      sql<{ at: Date; reported_at: Date; has_photo: boolean; people: number | null; hazard: string }[]>`
        select received_at as at, reported_at, photo_url is not null as has_photo,
               people_affected as people, hazard_type as hazard
        from public.reports where incident_id = ${id} order by received_at`,
      sql<{ at: Date; action: string; actor: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; team: string | null }[]>`
        select a.at, a.action, p.full_name as actor, a.before, a.after, t.name as team
        from public.audit_log a
        left join public.profiles p on p.id = a.actor_id
        left join public.assignments s on a.entity_type = 'assignment' and s.id::text = a.entity_id
        left join public.teams t on t.id = s.team_id
        where (a.entity_type = 'incident' and a.entity_id = ${id})
           or (a.entity_type = 'assignment' and s.incident_id = ${id})`,
      sql<{ at: Date; tier: string; recipients: number; title: string; actor: string | null }[]>`
        select a.created_at as at, a.tier, a.recipient_count as recipients, a.title, p.full_name as actor
        from public.alerts a left join public.profiles p on p.id = a.created_by where a.incident_id = ${id}`,
      sql<{ at: Date; quantity: number; unit: string; name: string; actor: string | null; released_at: Date | null }[]>`
        select a.allocated_at as at, a.quantity, r.unit, r.name, p.full_name as actor, a.released_at
        from public.resource_allocations a join public.resources r on r.id = a.resource_id
        left join public.profiles p on p.id = a.allocated_by where a.incident_id = ${id}`,
      sql<{ at: Date; reason: string; actor: string | null; cleared_at: Date | null }[]>`
        select b.created_at as at, b.reason, p.full_name as actor, b.cleared_at
        from public.blocked_roads b left join public.profiles p on p.id = b.marked_by where b.incident_id = ${id}`,
    ]);

    const events: IncidentTimelineEvent[] = [];
    const push = (at: Date, kind: IncidentTimelineEvent['kind'], text: string, actor: string | null = null) =>
      events.push({ at: at.toISOString(), kind, text, actor });

    push(inc.created_at, 'created',
      inc.origin === 'feed' ? 'Incident opened from official feed data' : 'Incident opened from a citizen report — awaiting verification');
    for (const s of signals) push(s.at, 'signal', `${SOURCE_LABEL[s.source] ?? s.source}: ${s.title ?? 'signal received'}`);
    reports.forEach((r, i) => {
      const delayMin = Math.round((+r.at - +r.reported_at) / 60_000);
      const parts = [i === 0 ? 'Citizen report received' : `Corroborating citizen report merged (${i + 1} total) — confidence raised`];
      if (r.has_photo) parts.push('with photo');
      if (r.people) parts.push(`${r.people} people affected`);
      if (delayMin >= 2) parts.push(`submitted offline, synced ${delayMin} min later`);
      push(r.at, 'report', parts.join(' · '));
    });
    for (const a of audits) push(a.at, a.action.startsWith('ASSIGNMENT') ? 'dispatch' : 'status', describeAudit(a), a.actor);
    for (const a of alerts) push(a.at, 'alert', `${a.tier} alert sent to ${a.recipients} people — "${a.title}"`, a.actor);
    for (const a of allocations) {
      push(a.at, 'resource', `Allocated ${a.quantity} ${a.unit} (${a.name})`, a.actor);
      if (a.released_at) push(a.released_at, 'resource', `Released ${a.quantity} ${a.unit} (${a.name})`);
    }
    for (const c of closures) {
      push(c.at, 'road', `Road closed: ${c.reason}`, c.actor);
      if (c.cleared_at) push(c.cleared_at, 'road', `Road reopened: ${c.reason}`);
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    res.json(events);
  },
);

const SOURCE_LABEL: Record<string, string> = {
  usgs: 'USGS', gdacs: 'GDACS', 'open-meteo': 'Open-Meteo', firms: 'NASA FIRMS', simulator: 'Simulator',
};

function describeAudit(a: { action: string; actor: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; team: string | null }): string {
  const who = a.actor ?? 'System';
  const note = typeof a.after?.note === 'string' && a.after.note ? ` — ${a.after.note}` : '';
  switch (a.action) {
    case 'INCIDENT_VERIFIED': return `Verified by ${who}${note}`;
    case 'INCIDENT_REJECTED': return `Dismissed by ${who}${a.after?.reason ? ` — ${a.after.reason}` : ''}`;
    case 'INCIDENT_STATUS_CHANGED': return `Status ${a.before?.status ?? '?'} → ${a.after?.status ?? '?'} by ${who}${note}`;
    case 'INCIDENT_UPDATED': return `Details updated by ${who}`;
    case 'ASSIGNMENT_CREATED': return `${a.team ?? 'A team'} dispatched by ${who}`;
    case 'ASSIGNMENT_STATUS_CHANGED': return `${a.team ?? 'Team'}: ${String(a.after?.status ?? '').replace('_', ' ').toLowerCase()}`;
    default: return `${a.action.toLowerCase().replace(/_/g, ' ')} by ${who}`;
  }
}

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
