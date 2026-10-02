import { Router } from 'express';
import { z } from 'zod';
import {
  auditQuerySchema,
  listUsersQuerySchema,
  setRoleSchema,
  simulateSchema,
  type AdminUser,
  type AuditEntry,
} from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { clearSimulation, runScenario } from '../simulator/scenarios.js';
import { fillPlaceNamesSoon } from '../lib/geocode.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);
const adminOnly = requireRole('ADMIN');

adminRouter.get('/users', requireRole('COORDINATOR', 'ADMIN'), async (req, res) => {
  const q = parse(listUsersQuerySchema, req.query);
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  res.json(await sql<AdminUser[]>`
    select p.id, u.email, p.full_name, p.role, p.team_id,
           p.last_location is not null as has_location, u.last_sign_in_at, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where 1 = 1
      ${q.role ? sql`and p.role = ${q.role}` : sql``}
      ${like ? sql`and (u.email ilike ${like} or p.full_name ilike ${like})` : sql``}
    order by p.created_at desc
    limit ${q.limit}
  `);
});

adminRouter.patch('/users/:id/role', adminOnly, async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { role } = parse(setRoleSchema, req.body);
  if (id === req.user!.id) throw new HttpError(409, 'You cannot change your own role');

  const [before] = await sql<{ role: string }[]>`select role from public.profiles where id = ${id}`;
  if (!before) throw new HttpError(404, 'User not found');
  await sql`
    update public.profiles
    set role = ${role}, team_id = case when ${role} = 'RESPONDER' then team_id else null end
    where id = ${id}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'USER_ROLE_CHANGED', entityType: 'user', entityId: id, before, after: { role } });
  res.json({ id, role });
});

adminRouter.get('/audit', adminOnly, async (req, res) => {
  const q = parse(auditQuerySchema, req.query);
  res.json(await sql<AuditEntry[]>`
    select a.id::int as id, a.actor_id, p.full_name as actor_name, a.action, a.entity_type, a.entity_id,
           a.before, a.after, a.at
    from public.audit_log a left join public.profiles p on p.id = a.actor_id
    where 1 = 1
      ${q.entity_type ? sql`and a.entity_type = ${q.entity_type}` : sql``}
      ${q.entity_id ? sql`and a.entity_id = ${q.entity_id}` : sql``}
      ${q.actor_id ? sql`and a.actor_id = ${q.actor_id}` : sql``}
      ${q.before_id ? sql`and a.id < ${q.before_id}` : sql``}
    order by a.id desc
    limit ${q.limit}
  `);
});

adminRouter.post('/simulate', adminOnly, async (req, res) => {
  const { scenario } = parse(simulateSchema, req.body);
  const result = await runScenario(scenario, req.user!.id);
  fillPlaceNamesSoon();
  await audit(sql, { actorId: req.user!.id, action: 'SIMULATION_RUN', entityType: 'simulation', entityId: scenario, after: result });
  res.status(201).json(result);
});

adminRouter.delete('/simulate', adminOnly, async (req, res) => {
  const result = await clearSimulation();
  await audit(sql, { actorId: req.user!.id, action: 'SIMULATION_CLEARED', entityType: 'simulation', entityId: 'all', after: result });
  res.json(result);
});
