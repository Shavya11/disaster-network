import { Router } from 'express';
import { listSignalsQuerySchema, type Signal } from '@dn/shared';
import { sql } from '../lib/db.js';
import { parse } from '../lib/http.js';

export const signalsRouter = Router();

// Public: raw events from the live feeds, for the map.
signalsRouter.get('/', async (req, res) => {
  const q = parse(listSignalsQuerySchema, req.query);
  const bbox = q.bbox;
  const since = q.since ?? new Date(Date.now() - 3 * 86_400_000).toISOString();

  const rows = await sql<Signal[]>`
    select
      s.id::int as id, s.source, s.source_event_id, s.hazard_type,
      json_build_object('lat', st_y(s.location::geometry), 'lon', st_x(s.location::geometry)) as location,
      s.magnitude::float8 as magnitude, s.title, s.occurred_at, s.payload, s.incident_id
    from public.raw_signals s
    -- Ongoing multi-day events (GDACS "until") count as recent while still active.
    where coalesce((s.payload ->> 'until')::timestamptz, s.occurred_at) >= ${since}
      ${q.source ? sql`and s.source = ${q.source}` : sql``}
      ${q.hazard ? sql`and s.hazard_type = ${q.hazard}` : sql``}
      ${bbox
        ? sql`and st_intersects(s.location,
                st_makeenvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)::geography)`
        : sql``}
    order by s.occurred_at desc
    limit ${q.limit}
  `;
  res.json(rows);
});
