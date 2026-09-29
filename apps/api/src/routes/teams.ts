import { Router } from 'express';
import { z } from 'zod';
import { createTeamSchema, teamLocationSchema, teamMemberSchema, updateTeamSchema, type Team } from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { distanceKmSql, latLonSql, pointSql } from '../lib/geo.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const teamsRouter = Router();
teamsRouter.use(requireAuth, requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'));
const staffOnly = requireRole('COORDINATOR', 'ADMIN');

const teamColumns = sql`
  t.id, t.name, t.type, t.status,
  ${latLonSql('t.base_location')} as base_location,
  ${latLonSql('t.current_location')} as current_location,
  t.location_updated_at, t.member_count,
  (select a.id from public.assignments a
   where a.team_id = t.id and a.status not in ('COMPLETED', 'CANCELLED')) as active_assignment_id
`;

async function loadTeam(id: string): Promise<Team> {
  const [t] = await sql<Team[]>`select ${teamColumns} from public.teams t where t.id = ${id}`;
  if (!t) throw new HttpError(404, 'Team not found');
  return t;
}

const idParam = (raw: unknown) => parse(z.string().uuid(), raw);

// ?near_incident=<id> sorts by distance (from current position, else base) — for the "assign team" picker.
teamsRouter.get('/', async (req, res) => {
  const nearIncident = req.query.near_incident ? idParam(req.query.near_incident) : null;
  if (!nearIncident) {
    res.json(await sql<Team[]>`select ${teamColumns} from public.teams t order by t.name`);
    return;
  }
  const [inc] = await sql<{ lat: number; lon: number }[]>`
    select st_y(epicenter::geometry) as lat, st_x(epicenter::geometry) as lon
    from public.incidents where id = ${nearIncident}
  `;
  if (!inc) throw new HttpError(404, 'Incident not found');
  res.json(await sql<Team[]>`
    select ${teamColumns},
      ${distanceKmSql('coalesce(t.current_location, t.base_location)', inc.lon, inc.lat)} as distance_km
    from public.teams t
    order by (t.status = 'AVAILABLE') desc, distance_km
  `);
});

teamsRouter.get('/mine', async (req, res) => {
  const [p] = await sql<{ team_id: string | null }[]>`select team_id from public.profiles where id = ${req.user!.id}`;
  if (!p?.team_id) throw new HttpError(404, 'You are not a member of any team');
  res.json(await loadTeam(p.team_id));
});

teamsRouter.post('/', staffOnly, async (req, res) => {
  const input = parse(createTeamSchema, req.body);
  const [row] = await sql<{ id: string }[]>`
    insert into public.teams (name, type, base_location, member_count)
    values (${input.name}, ${input.type}, ${pointSql(input.base.lon, input.base.lat)}, ${input.member_count})
    on conflict (name) do nothing
    returning id
  `;
  if (!row) throw new HttpError(409, 'A team with this name already exists');
  await audit(sql, { actorId: req.user!.id, action: 'TEAM_CREATED', entityType: 'team', entityId: row.id, after: input });
  res.status(201).json(await loadTeam(row.id));
});

teamsRouter.patch('/:id', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(updateTeamSchema, req.body);
  const before = await loadTeam(id);
  if (input.status && input.status !== 'ASSIGNED' && before.active_assignment_id) {
    throw new HttpError(409, 'Team has an open assignment; complete or cancel it first');
  }
  const cols = Object.keys(input) as (keyof typeof input)[];
  if (cols.length) await sql`update public.teams set ${sql(input, cols)} where id = ${id}`;
  const after = await loadTeam(id);
  await audit(sql, { actorId: req.user!.id, action: 'TEAM_UPDATED', entityType: 'team', entityId: id, before, after });
  res.json(after);
});

// Live position: any member of the team, or staff.
teamsRouter.put('/:id/location', async (req, res) => {
  const id = idParam(req.params.id);
  const { lat, lon } = parse(teamLocationSchema, req.body);
  if (req.user!.role === 'RESPONDER') {
    const [p] = await sql<{ team_id: string | null }[]>`select team_id from public.profiles where id = ${req.user!.id}`;
    if (p?.team_id !== id) throw new HttpError(403, 'You can only update your own team');
  }
  await sql`
    update public.teams set current_location = ${pointSql(lon, lat)}, location_updated_at = now()
    where id = ${id}
  `;
  res.json(await loadTeam(id));
});

teamsRouter.post('/:id/members', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const { user_id } = parse(teamMemberSchema, req.body);
  await loadTeam(id);
  const [u] = await sql<{ role: string }[]>`select role from public.profiles where id = ${user_id}`;
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role !== 'RESPONDER') throw new HttpError(409, 'Only RESPONDER users can join a team');
  await sql`update public.profiles set team_id = ${id} where id = ${user_id}`;
  await audit(sql, { actorId: req.user!.id, action: 'TEAM_MEMBER_ADDED', entityType: 'team', entityId: id, after: { user_id } });
  res.status(204).end();
});

teamsRouter.delete('/:id/members/:userId', staffOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const userId = idParam(req.params.userId);
  await sql`update public.profiles set team_id = null where id = ${userId} and team_id = ${id}`;
  await audit(sql, { actorId: req.user!.id, action: 'TEAM_MEMBER_REMOVED', entityType: 'team', entityId: id, after: { user_id: userId } });
  res.status(204).end();
});
