import { Router } from 'express';
import { z } from 'zod';
import { createCheckinSchema, type Checkin, type CheckinSummary } from '@dn/shared';
import { sql } from '../lib/db.js';
import { latLonSql, pointSql } from '../lib/geo.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const checkinsRouter = Router();
checkinsRouter.use(requireAuth);

const checkinColumns = sql`
  c.id, c.user_id, c.incident_id, c.status, ${latLonSql('c.location')} as location, c.note, c.created_at
`;

// "I'm safe" / "I need help". Without an incident id, it is linked to the open
// incident whose affected area contains the user's position, if there is one.
checkinsRouter.post('/', async (req, res) => {
  const input = parse(createCheckinSchema, req.body);
  if ((input.lat == null) !== (input.lon == null)) throw new HttpError(400, 'Send both lat and lon, or neither');

  const location = input.lat != null && input.lon != null
    ? pointSql(input.lon, input.lat)
    : sql`(select last_location from public.profiles where id = ${req.user!.id})`;

  if (input.incident_id) {
    const [inc] = await sql`select 1 from public.incidents where id = ${input.incident_id}`;
    if (!inc) throw new HttpError(404, 'Incident not found');
  }

  const [row] = await sql<Checkin[]>`
    with loc as (select ${location} as g)
    insert into public.safe_checkins as c (user_id, incident_id, status, location, note)
    select ${req.user!.id},
      coalesce(${input.incident_id ?? null}::uuid, (
        select i.id from public.incidents i
        where i.status in ('REPORTED', 'VERIFIED', 'ACTIVE', 'CONTAINED')
          and loc.g is not null and st_covers(i.affected_area, loc.g)
        order by i.severity_score desc limit 1
      )),
      ${input.status}, loc.g, ${input.note ?? null}
    from loc
    returning ${checkinColumns}
  `;
  res.status(201).json(row);
});

checkinsRouter.get('/mine', async (req, res) => {
  res.json(await sql<Checkin[]>`
    select ${checkinColumns} from public.safe_checkins c
    where c.user_id = ${req.user!.id} order by c.created_at desc limit 50
  `);
});

// Latest check-in per person for an incident.
checkinsRouter.get(
  '/summary',
  requireRole('RESPONDER', 'COORDINATOR', 'ADMIN'),
  async (req, res) => {
    const incidentId = parse(z.string().uuid(), req.query.incident_id);
    const latest = await sql<(Checkin & { user_name: string | null })[]>`
      select distinct on (c.user_id) ${checkinColumns}, p.full_name as user_name
      from public.safe_checkins c join public.profiles p on p.id = c.user_id
      where c.incident_id = ${incidentId}
      order by c.user_id, c.created_at desc
    `;
    const summary: CheckinSummary = {
      incident_id: incidentId,
      safe: latest.filter((c) => c.status === 'SAFE').length,
      need_help: latest.filter((c) => c.status === 'NEED_HELP').length,
      need_help_list: latest.filter((c) => c.status === 'NEED_HELP'),
    };
    res.json(summary);
  },
);
