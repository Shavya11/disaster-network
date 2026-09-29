import { Router } from 'express';
import { z } from 'zod';
import {
  allocateResourceSchema,
  createResourceSchema,
  updateResourceSchema,
  type Resource,
  type ResourceAllocation,
} from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { distanceKmSql, latLonSql, pointSql } from '../lib/geo.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth, requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'));
const staffOnly = requireRole('COORDINATOR', 'ADMIN');

const resourceColumns = sql`
  r.id, r.type, r.name, r.unit, r.quantity, r.available, r.depot_name, ${latLonSql('r.location')} as location
`;
const allocationColumns = sql`
  a.id, a.resource_id, r.name as resource_name, r.unit, a.incident_id, a.quantity,
  a.allocated_by, a.allocated_at, a.released_at
`;

const listQuery = z.object({
  type: z.string().max(50).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

// With lat/lon, sorted nearest first (for "what can reach this incident").
resourcesRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const near = q.lat != null && q.lon != null;
  res.json(await sql<Resource[]>`
    select ${resourceColumns}
      ${near ? sql`, ${distanceKmSql('r.location', q.lon!, q.lat!)} as distance_km` : sql``}
    from public.resources r
    where 1 = 1 ${q.type ? sql`and r.type = ${q.type}` : sql``}
    order by ${near ? sql`distance_km` : sql`r.type, r.name`}
    limit 500
  `);
});

resourcesRouter.post('/', staffOnly, async (req, res) => {
  const input = parse(createResourceSchema, req.body);
  const [row] = await sql<Resource[]>`
    insert into public.resources as r (type, name, unit, quantity, available, depot_name, location)
    values (${input.type}, ${input.name}, ${input.unit}, ${input.quantity}, ${input.quantity},
            ${input.depot_name}, ${pointSql(input.location.lon, input.location.lat)})
    returning ${resourceColumns}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'RESOURCE_CREATED', entityType: 'resource', entityId: row!.id, after: input });
  res.status(201).json(row);
});

// Changing stock keeps the allocated amount fixed: available moves by the same delta.
resourcesRouter.patch('/:id', staffOnly, async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { quantity } = parse(updateResourceSchema, req.body);
  const [before] = await sql<Resource[]>`select ${resourceColumns} from public.resources r where r.id = ${id}`;
  if (!before) throw new HttpError(404, 'Resource not found');
  const allocated = before.quantity - before.available;
  if (quantity < allocated) throw new HttpError(409, `${allocated} ${before.unit} are currently allocated`);

  const [row] = await sql<Resource[]>`
    update public.resources r set quantity = ${quantity}, available = ${quantity - allocated}
    where r.id = ${id} returning ${resourceColumns}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'RESOURCE_UPDATED', entityType: 'resource', entityId: id, before, after: row });
  res.json(row);
});

resourcesRouter.get('/allocations', async (req, res) => {
  const incidentId = req.query.incident_id ? parse(z.string().uuid(), req.query.incident_id) : null;
  res.json(await sql<ResourceAllocation[]>`
    select ${allocationColumns}
    from public.resource_allocations a join public.resources r on r.id = a.resource_id
    where 1 = 1 ${incidentId ? sql`and a.incident_id = ${incidentId}` : sql``}
    order by a.released_at is null desc, a.allocated_at desc
    limit 500
  `);
});

resourcesRouter.post('/allocate', staffOnly, async (req, res) => {
  const input = parse(allocateResourceSchema, req.body);
  const allocationId = await sql.begin(async (tx) => {
    const [r] = await tx<{ available: number; unit: string }[]>`
      select available, unit from public.resources where id = ${input.resource_id} for update
    `;
    if (!r) throw new HttpError(404, 'Resource not found');
    if (r.available < input.quantity) throw new HttpError(409, `Only ${r.available} ${r.unit} available`);
    const [inc] = await tx<{ status: string }[]>`select status from public.incidents where id = ${input.incident_id}`;
    if (!inc) throw new HttpError(404, 'Incident not found');
    if (['RESOLVED', 'REJECTED'].includes(inc.status)) throw new HttpError(409, `Incident is ${inc.status}`);

    await tx`update public.resources set available = available - ${input.quantity} where id = ${input.resource_id}`;
    const [a] = await tx<{ id: string }[]>`
      insert into public.resource_allocations (resource_id, incident_id, quantity, allocated_by)
      values (${input.resource_id}, ${input.incident_id}, ${input.quantity}, ${req.user!.id})
      returning id
    `;
    await audit(tx, { actorId: req.user!.id, action: 'RESOURCE_ALLOCATED', entityType: 'resource_allocation', entityId: a!.id, after: input });
    return a!.id;
  });
  const [row] = await sql<ResourceAllocation[]>`
    select ${allocationColumns} from public.resource_allocations a
    join public.resources r on r.id = a.resource_id where a.id = ${allocationId}
  `;
  res.status(201).json(row);
});

resourcesRouter.post('/allocations/:id/release', staffOnly, async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  await sql.begin(async (tx) => {
    const [a] = await tx<{ resource_id: string; quantity: number; released_at: Date | null }[]>`
      select resource_id, quantity, released_at from public.resource_allocations where id = ${id} for update
    `;
    if (!a) throw new HttpError(404, 'Allocation not found');
    if (a.released_at) throw new HttpError(409, 'Already released');
    await tx`update public.resource_allocations set released_at = now() where id = ${id}`;
    await tx`update public.resources set available = available + ${a.quantity} where id = ${a.resource_id}`;
    await audit(tx, { actorId: req.user!.id, action: 'RESOURCE_RELEASED', entityType: 'resource_allocation', entityId: id });
  });
  const [row] = await sql<ResourceAllocation[]>`
    select ${allocationColumns} from public.resource_allocations a
    join public.resources r on r.id = a.resource_id where a.id = ${id}
  `;
  res.json(row);
});
