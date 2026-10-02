import { Router } from 'express';
import { z } from 'zod';
import {
  ASSIGNMENT_STATUSES,
  createAssignmentSchema,
  updateAssignmentStatusSchema,
  type Assignment,
  type AssignmentStatus,
  type SeverityTier,
} from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { latLonSql } from '../lib/geo.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth, requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'));
const staffOnly = requireRole('COORDINATOR', 'ADMIN');

/** Default time-to-scene by severity tier. */
const SLA_MINUTES: Record<SeverityTier, number> = { EMERGENCY: 30, WARNING: 60, WATCH: 120, INFO: 240 };

const OPEN = ['ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE'];

const assignmentColumns = sql`
  a.id, a.incident_id, 'INC-' || i.ref_no as incident_reference, i.place_name as incident_place, a.team_id, t.name as team_name, t.member_count as team_members,
  i.title as incident_title, i.hazard_type as incident_hazard, i.severity_tier as incident_tier,
  ${latLonSql('i.epicenter')} as incident_location,
  a.assigned_by, a.status, a.instructions, a.sla_deadline,
  (coalesce(a.on_scene_at, now()) > a.sla_deadline and a.status <> 'CANCELLED') as sla_breached,
  a.created_at, a.acknowledged_at, a.en_route_at, a.on_scene_at, a.completed_at, a.updated_at
`;
const fromJoin = sql`
  from public.assignments a
  join public.teams t on t.id = a.team_id
  join public.incidents i on i.id = a.incident_id
`;

async function loadAssignment(id: string): Promise<Assignment> {
  const [a] = await sql<Assignment[]>`select ${assignmentColumns} ${fromJoin} where a.id = ${id}`;
  if (!a) throw new HttpError(404, 'Assignment not found');
  return a;
}

const listQuery = z.object({
  incident_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
});

assignmentsRouter.get('/', staffOnly, async (req, res) => {
  const q = parse(listQuery, req.query);
  res.json(await sql<Assignment[]>`
    select ${assignmentColumns} ${fromJoin}
    where 1 = 1
      ${q.incident_id ? sql`and a.incident_id = ${q.incident_id}` : sql``}
      ${q.team_id ? sql`and a.team_id = ${q.team_id}` : sql``}
      ${q.status ? sql`and a.status = ${q.status}` : sql``}
      ${q.open === 'true' ? sql`and a.status in ${sql(OPEN)}` : sql``}
    order by (a.status in ${sql(OPEN)}) desc, a.sla_deadline
    limit 200
  `);
});

// Responder's own team: open assignments first.
assignmentsRouter.get('/mine', async (req, res) => {
  res.json(await sql<Assignment[]>`
    select ${assignmentColumns} ${fromJoin}
    where a.team_id = (select team_id from public.profiles where id = ${req.user!.id})
    order by (a.status in ${sql(OPEN)}) desc, a.created_at desc
    limit 50
  `);
});

assignmentsRouter.get('/:id', async (req, res) => {
  const a = await loadAssignment(parse(z.string().uuid(), req.params.id));
  await assertCanAct(req.user!.id, req.user!.role, a.team_id);
  res.json(a);
});

assignmentsRouter.post('/', staffOnly, async (req, res) => {
  const input = parse(createAssignmentSchema, req.body);

  const id = await sql.begin(async (tx) => {
    const [inc] = await tx<{ status: string; severity_tier: SeverityTier }[]>`
      select status, severity_tier from public.incidents where id = ${input.incident_id} for update
    `;
    if (!inc) throw new HttpError(404, 'Incident not found');
    if (!['VERIFIED', 'ACTIVE', 'CONTAINED'].includes(inc.status)) {
      throw new HttpError(409, `Teams can only be assigned to verified incidents (current: ${inc.status})`);
    }
    const [team] = await tx<{ status: string }[]>`
      select status from public.teams where id = ${input.team_id} for update
    `;
    if (!team) throw new HttpError(404, 'Team not found');
    if (team.status !== 'AVAILABLE') throw new HttpError(409, `Team is ${team.status}`);

    const minutes = input.sla_minutes ?? SLA_MINUTES[inc.severity_tier];
    const [row] = await tx<{ id: string }[]>`
      insert into public.assignments (incident_id, team_id, assigned_by, instructions, sla_deadline)
      values (${input.incident_id}, ${input.team_id}, ${req.user!.id}, ${input.instructions ?? null},
              now() + make_interval(mins => ${minutes}))
      returning id
    `;
    await tx`update public.teams set status = 'ASSIGNED' where id = ${input.team_id}`;
    // Dispatching a team makes a verified incident active.
    if (inc.status === 'VERIFIED') {
      await tx`update public.incidents set status = 'ACTIVE', last_activity_at = now() where id = ${input.incident_id}`;
      await audit(tx, {
        actorId: req.user!.id, action: 'INCIDENT_STATUS_CHANGED', entityType: 'incident', entityId: input.incident_id,
        before: { status: 'VERIFIED' }, after: { status: 'ACTIVE', note: 'team dispatched' },
      });
    }
    await audit(tx, {
      actorId: req.user!.id, action: 'ASSIGNMENT_CREATED', entityType: 'assignment', entityId: row!.id,
      after: { ...input, sla_minutes: minutes },
    });
    return row!.id;
  });
  res.status(201).json(await loadAssignment(id));
});

const NEXT: Record<AssignmentStatus, AssignmentStatus[]> = {
  ASSIGNED: ['ACKNOWLEDGED', 'CANCELLED'],
  ACKNOWLEDGED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ON_SCENE', 'CANCELLED'],
  ON_SCENE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const TIMESTAMP_COLUMN: Partial<Record<AssignmentStatus, string>> = {
  ACKNOWLEDGED: 'acknowledged_at',
  EN_ROUTE: 'en_route_at',
  ON_SCENE: 'on_scene_at',
  COMPLETED: 'completed_at',
};

async function assertCanAct(userId: string, role: string, teamId: string) {
  if (role !== 'RESPONDER') return;
  const [p] = await sql<{ team_id: string | null }[]>`select team_id from public.profiles where id = ${userId}`;
  if (p?.team_id !== teamId) throw new HttpError(403, 'This assignment belongs to another team');
}

assignmentsRouter.patch('/:id/status', async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { status, note } = parse(updateAssignmentStatusSchema, req.body);
  const current = await loadAssignment(id);
  await assertCanAct(req.user!.id, req.user!.role, current.team_id);
  if (status === 'CANCELLED' && req.user!.role === 'RESPONDER') {
    throw new HttpError(403, 'Only a coordinator can cancel an assignment');
  }
  if (!NEXT[current.status].includes(status)) {
    throw new HttpError(409, `Cannot move from ${current.status} to ${status}`, { allowed: NEXT[current.status] });
  }

  await sql.begin(async (tx) => {
    const tsCol = TIMESTAMP_COLUMN[status];
    await tx`
      update public.assignments set status = ${status}
        ${tsCol ? tx`, ${tx(tsCol)} = now()` : tx``}
      where id = ${id}
    `;
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      await tx`update public.teams set status = 'AVAILABLE' where id = ${current.team_id}`;
    }
    await tx`update public.incidents set last_activity_at = now() where id = ${current.incident_id}`;
    await audit(tx, {
      actorId: req.user!.id, action: 'ASSIGNMENT_STATUS_CHANGED', entityType: 'assignment', entityId: id,
      before: { status: current.status }, after: { status, note: note ?? null },
    });
  });
  res.json(await loadAssignment(id));
});
