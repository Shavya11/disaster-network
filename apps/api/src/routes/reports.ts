import { Router } from 'express';
import { bulkReportsSchema, createReportSchema, type CreateReportInput, type Report } from '@dn/shared';
import type { Sql } from 'postgres';
import { env } from '../config/env.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { correlateReport, withCorrelationLock } from '../intelligence/correlate.js';
import { requireAuth } from '../middleware/auth.js';
import { fillPlaceNamesSoon } from '../lib/geocode.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

// Above the 50-report bulk cap so a full offline queue can always sync in one go.
const MAX_REPORTS_PER_HOUR = 60;
const MAX_AGE_MS = 7 * 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;

const reportColumns = sql`
  r.id, r.user_id, r.incident_id, r.hazard_type,
  json_build_object('lat', st_y(r.location::geometry), 'lon', st_x(r.location::geometry)) as location,
  r.description, r.photo_url, r.people_affected, r.client_generated_id, r.reported_at, r.received_at
`;

function validate(input: CreateReportInput, userId: string) {
  const at = Date.parse(input.reported_at);
  if (at > Date.now() + CLOCK_SKEW_MS) throw new HttpError(400, 'reported_at is in the future');
  if (at < Date.now() - MAX_AGE_MS) throw new HttpError(400, 'reported_at is older than 7 days');

  // Only photos the user uploaded to our own bucket are accepted.
  const prefix = `${env.SUPABASE_URL}/storage/v1/object/public/report-photos/${userId}/`;
  if (input.photo_url && !input.photo_url.startsWith(prefix)) {
    throw new HttpError(400, 'photo_url must point to your folder in the report-photos bucket');
  }
}

// Only reports not already received count, so re-syncing an offline queue is never blocked.
async function enforceRateLimit(userId: string, clientIds: string[]) {
  const [row] = await sql<{ recent: number; known: number }[]>`
    select
      (select count(*)::int from public.reports
       where user_id = ${userId} and received_at > now() - interval '1 hour') as recent,
      (select count(*)::int from public.reports where client_generated_id in ${sql(clientIds)}) as known
  `;
  const fresh = clientIds.length - row!.known;
  if (fresh > 0 && row!.recent + fresh > MAX_REPORTS_PER_HOUR) {
    throw new HttpError(429, 'Too many reports; try again later');
  }
}

/** Idempotent on client_generated_id: re-sending returns the original report. */
async function insertReport(db: Sql, input: CreateReportInput, userId: string) {
  const [inserted] = await db<{ id: string }[]>`
    insert into public.reports
      (user_id, hazard_type, location, description, photo_url, people_affected, client_generated_id, reported_at)
    values (
      ${userId}, ${input.hazard_type},
      st_setsrid(st_makepoint(${input.lon}, ${input.lat}), 4326)::geography,
      ${input.description ?? null}, ${input.photo_url ?? null}, ${input.people_affected ?? null},
      ${input.client_generated_id}, ${input.reported_at}
    )
    on conflict (client_generated_id) do nothing
    returning id
  `;
  if (inserted) {
    await correlateReport(db, inserted.id);
    return { id: inserted.id, duplicate: false };
  }

  const [existing] = await db<{ id: string; user_id: string }[]>`
    select id, user_id from public.reports where client_generated_id = ${input.client_generated_id}
  `;
  if (!existing || existing.user_id !== userId) {
    throw new HttpError(409, 'client_generated_id already used');
  }
  return { id: existing.id, duplicate: true };
}

const loadReports = (ids: string[]) =>
  sql<Report[]>`select ${reportColumns} from public.reports r where r.id in ${sql(ids)}`;

reportsRouter.post('/', async (req, res) => {
  const input = parse(createReportSchema, req.body);
  const userId = req.user!.id;
  validate(input, userId);
  await enforceRateLimit(userId, [input.client_generated_id]);

  const { id, duplicate } = await withCorrelationLock((db) => insertReport(db, input, userId));
  const [report] = await loadReports([id]);
  if (!duplicate) fillPlaceNamesSoon();
  res.status(duplicate ? 200 : 201).json(report);
});

// Offline queue flush. Each report is processed independently; one bad entry doesn't fail the rest.
reportsRouter.post('/bulk', async (req, res) => {
  const { reports } = parse(bulkReportsSchema, req.body);
  const userId = req.user!.id;
  await enforceRateLimit(userId, reports.map((r) => r.client_generated_id));

  const results: { client_generated_id: string; status: 'created' | 'duplicate' | 'error'; id?: string; error?: string }[] = [];
  for (const input of reports) {
    try {
      validate(input, userId);
      const r = await withCorrelationLock((db) => insertReport(db, input, userId));
      results.push({ client_generated_id: input.client_generated_id, status: r.duplicate ? 'duplicate' : 'created', id: r.id });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Internal error';
      if (!(err instanceof HttpError)) console.error(err);
      results.push({ client_generated_id: input.client_generated_id, status: 'error', error: message });
    }
  }
  fillPlaceNamesSoon();
  res.json({ results });
});

reportsRouter.get('/mine', async (req, res) => {
  const rows = await sql<Report[]>`
    select ${reportColumns}, i.status as incident_status
    from public.reports r
    left join public.incidents i on i.id = r.incident_id
    where r.user_id = ${req.user!.id}
    order by r.reported_at desc
    limit 100
  `;
  res.json(rows);
});

export { reportColumns };
