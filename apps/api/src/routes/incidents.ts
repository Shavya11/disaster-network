import { Router } from 'express';
import { z } from 'zod';
import { listIncidentsQuerySchema, type Incident } from '@dn/shared';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';

export const incidentsRouter = Router();

const incidentColumns = sql`
  i.id, i.hazard_type, i.title, i.description, i.status,
  i.severity_score::float8 as severity_score, i.severity_tier,
  json_build_object('lat', st_y(i.epicenter::geometry), 'lon', st_x(i.epicenter::geometry)) as epicenter,
  st_asgeojson(i.affected_area)::json as affected_area,
  i.report_count, i.signal_count, i.confidence::float8 as confidence,
  i.verified_by, i.verified_at, i.created_at, i.updated_at, i.resolved_at
`;

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
      ${q.since ? sql`and i.created_at >= ${q.since}` : sql``}
      ${bbox
        ? sql`and st_intersects(i.epicenter,
                st_makeenvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)::geography)`
        : sql``}
    order by i.created_at desc
    limit ${q.limit}
  `;
  res.json(rows);
});

incidentsRouter.get('/:id', async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const [row] = await sql<Incident[]>`
    select ${incidentColumns} from public.incidents i where i.id = ${id}
  `;
  if (!row) throw new HttpError(404, 'Incident not found');
  res.json(row);
});
