import { Router } from 'express';
import type { FeedHealth } from '@dn/shared';
import { sql } from '../lib/db.js';
import { HttpError } from '../lib/http.js';
import { ADAPTERS, runFeed } from '../ingestion/runner.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminFeedsRouter = Router();
adminFeedsRouter.use(requireAuth, requireRole('COORDINATOR', 'ADMIN'));

adminFeedsRouter.get('/health', async (_req, res) => {
  const sources = Object.keys(ADAPTERS);
  const rows = await sql<FeedHealth[]>`
    with src as (select unnest(${sources}::text[]) as source),
    last_run as (
      select distinct on (source) * from public.feed_runs
      where finished_at is not null
      order by source, started_at desc
    ),
    last_ok as (
      select source, max(finished_at) as at from public.feed_runs where ok group by source
    ),
    day as (
      select source,
             count(*)::int as runs,
             count(*) filter (where ok)::int as ok_runs,
             coalesce(sum(inserted), 0)::int as inserted
      from public.feed_runs
      where started_at > now() - interval '24 hours' and finished_at is not null
      group by source
    )
    select
      src.source,
      lr.finished_at as last_run_at,
      lr.ok as last_run_ok,
      lr.error as last_error,
      lo.at as last_success_at,
      coalesce(d.runs, 0) as runs_24h,
      case when coalesce(d.runs, 0) = 0 then null
           else round(100.0 * d.ok_runs / d.runs, 1)::float8 end as success_rate_24h,
      coalesce(d.inserted, 0) as new_signals_24h,
      (select count(*)::int from public.raw_signals r where r.source = src.source) as total_signals
    from src
    left join last_run lr on lr.source = src.source
    left join last_ok lo on lo.source = src.source
    left join day d on d.source = src.source
    order by src.source
  `;
  res.json(rows);
});

adminFeedsRouter.post('/:source/poll', requireRole('ADMIN'), async (req, res) => {
  const adapter = ADAPTERS[req.params.source as string];
  if (!adapter) throw new HttpError(404, `Unknown source: ${req.params.source}`);
  res.json(await runFeed(adapter));
});
