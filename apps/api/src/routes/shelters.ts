import { Router } from 'express';
import { z } from 'zod';
import { createShelterSchema, nearbyQuerySchema, updateShelterSchema, type Shelter } from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { distanceKmSql, latLonSql, pointSql } from '../lib/geo.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const sheltersRouter = Router();

const shelterColumns = sql`
  s.id, s.name, s.kind, ${latLonSql('s.location')} as location, s.capacity, s.current_occupancy,
  greatest(s.capacity - s.current_occupancy, 0) as spaces_left,
  s.facilities, s.contact_phone, s.status, s.updated_at
`;

// Public: nearest open shelters first, full/closed ones last.
sheltersRouter.get('/nearby', async (req, res) => {
  const q = parse(nearbyQuerySchema, req.query);
  res.json(await sql<Shelter[]>`
    select ${shelterColumns}, ${distanceKmSql('s.location', q.lon, q.lat)} as distance_km
    from public.shelters s
    where st_dwithin(s.location, ${pointSql(q.lon, q.lat)}, ${q.radius_km * 1000})
    order by (s.status = 'OPEN') desc, distance_km
    limit ${q.limit}
  `);
});

const listQuery = z.object({ kind: z.string().max(30).optional() });

sheltersRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  res.json(await sql<Shelter[]>`
    select ${shelterColumns} from public.shelters s
    where 1 = 1 ${q.kind ? sql`and s.kind = ${q.kind}` : sql``}
    order by s.name limit 1000
  `);
});

sheltersRouter.post('/', requireAuth, requireRole('COORDINATOR', 'ADMIN'), async (req, res) => {
  const input = parse(createShelterSchema, req.body);
  const [row] = await sql<Shelter[]>`
    insert into public.shelters as s (name, kind, location, capacity, facilities, contact_phone)
    values (${input.name}, ${input.kind}, ${pointSql(input.location.lon, input.location.lat)},
            ${input.capacity}, ${input.facilities}, ${input.contact_phone ?? null})
    returning ${shelterColumns}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'SHELTER_CREATED', entityType: 'shelter', entityId: row!.id, after: input });
  res.status(201).json(row);
});

// Responders at a shelter update occupancy. Status flips OPEN <-> FULL automatically unless CLOSED.
sheltersRouter.patch('/:id', requireAuth, requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'), async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const input = parse(updateShelterSchema, req.body);
  const [before] = await sql<Shelter[]>`select ${shelterColumns} from public.shelters s where s.id = ${id}`;
  if (!before) throw new HttpError(404, 'Shelter not found');

  const capacity = input.capacity ?? before.capacity;
  const occupancy = input.current_occupancy ?? before.current_occupancy;
  let status = input.status ?? before.status;
  if (status !== 'CLOSED') status = occupancy >= capacity && capacity > 0 ? 'FULL' : 'OPEN';

  const changes = { ...input, status };
  const cols = Object.keys(changes) as (keyof typeof changes)[];
  const [row] = await sql<Shelter[]>`
    update public.shelters s set ${sql(changes, cols)} where s.id = ${id} returning ${shelterColumns}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'SHELTER_UPDATED', entityType: 'shelter', entityId: id, before, after: row });
  res.json(row);
});
