import { Router } from 'express';
import { z } from 'zod';
import { blockRoadSchema, routeQuerySchema, type BlockedRoad } from '@dn/shared';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { findRoute } from '../routing/router.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const roadsRouter = Router();
export const routingRouter = Router();

const roadColumns = sql`
  b.id, st_asgeojson(b.segment)::json as segment, b.reason, b.incident_id, b.marked_by,
  b.active, b.created_at, b.cleared_at
`;

roadsRouter.get('/blocked', async (_req, res) => {
  res.json(await sql<BlockedRoad[]>`
    select ${roadColumns} from public.blocked_roads b where b.active order by b.created_at desc
  `);
});

roadsRouter.post('/block', requireAuth, requireRole('COORDINATOR', 'ADMIN'), async (req, res) => {
  const input = parse(blockRoadSchema, req.body);
  const geojson = JSON.stringify({ type: 'LineString', coordinates: input.coordinates });
  const [row] = await sql<BlockedRoad[]>`
    insert into public.blocked_roads as b (segment, reason, incident_id, marked_by)
    values (st_setsrid(st_geomfromgeojson(${geojson}), 4326)::geography, ${input.reason},
            ${input.incident_id ?? null}, ${req.user!.id})
    returning ${roadColumns}
  `;
  await audit(sql, { actorId: req.user!.id, action: 'ROAD_BLOCKED', entityType: 'blocked_road', entityId: row!.id, after: input });
  res.status(201).json(row);
});

roadsRouter.post('/:id/clear', requireAuth, requireRole('COORDINATOR', 'ADMIN'), async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const [row] = await sql<BlockedRoad[]>`
    update public.blocked_roads b set active = false, cleared_at = now()
    where b.id = ${id} and b.active returning ${roadColumns}
  `;
  if (!row) throw new HttpError(404, 'No active closure with this id');
  await audit(sql, { actorId: req.user!.id, action: 'ROAD_CLEARED', entityType: 'blocked_road', entityId: id });
  res.json(row);
});

// Authenticated to protect the shared public routing server from anonymous abuse.
routingRouter.get('/path', requireAuth, async (req, res) => {
  const { from, to } = parse(routeQuerySchema, req.query);
  try {
    res.json(await findRoute(from, to));
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : 'Routing failed');
  }
});
