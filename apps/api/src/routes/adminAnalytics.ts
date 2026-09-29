import { Router } from 'express';
import { analyticsQuerySchema, type Analytics } from '@dn/shared';
import { sql } from '../lib/db.js';
import { parse } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminAnalyticsRouter = Router();
adminAnalyticsRouter.use(requireAuth, requireRole('COORDINATOR', 'ADMIN'));

const toRecord = (rows: { k: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.k, r.n]));

adminAnalyticsRouter.get('/', async (req, res) => {
  const { days } = parse(analyticsQuerySchema, req.query);
  const since = sql`now() - make_interval(days => ${days})`;

  const [
    byStatus, byHazard, byTier, perDay, [response], [assign], [reports], feeds, [checkins],
  ] = await Promise.all([
    sql<{ k: string; n: number }[]>`
      select status::text as k, count(*)::int as n from public.incidents where created_at > ${since} group by 1`,
    sql<{ hazard_type: string; count: number }[]>`
      select hazard_type, count(*)::int as count from public.incidents
      where created_at > ${since} and status <> 'REJECTED' group by 1 order by 2 desc`,
    sql<{ k: string; n: number }[]>`
      select severity_tier::text as k, count(*)::int as n from public.incidents
      where created_at > ${since} and status <> 'REJECTED' group by 1`,
    sql<{ day: string; count: number }[]>`
      select to_char(d, 'YYYY-MM-DD') as day, count(i.id)::int as count
      from generate_series(date_trunc('day', ${since}), date_trunc('day', now()), interval '1 day') d
      left join public.incidents i on date_trunc('day', i.created_at) = d and i.status <> 'REJECTED'
      group by d order by d`,
    sql<{ median_verify: number | null }[]>`
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from verified_at - created_at) / 60))::numeric, 1)::float8 as median_verify
      from public.incidents where created_at > ${since} and verified_at is not null`,
    sql<{ total: number; median_scene: number | null; sla_met_pct: number | null }[]>`
      select count(*)::int as total,
        round((percentile_cont(0.5) within group (
          order by extract(epoch from on_scene_at - created_at) / 60)
          filter (where on_scene_at is not null))::numeric, 1)::float8 as median_scene,
        round((100.0 * count(*) filter (where on_scene_at <= sla_deadline)
          / nullif(count(*) filter (where on_scene_at is not null or sla_deadline < now()), 0))::numeric, 1)::float8
          as sla_met_pct
      from public.assignments where created_at > ${since} and status <> 'CANCELLED'`,
    sql<{ total: number; with_photo: number; verified_pct: number | null }[]>`
      select count(*)::int as total,
        count(*) filter (where r.photo_url is not null)::int as with_photo,
        round((100.0 * count(*) filter (where i.verified_by is not null and i.status <> 'REJECTED')
          / nullif(count(*), 0))::numeric, 1)::float8 as verified_pct
      from public.reports r left join public.incidents i on i.id = r.incident_id
      where r.received_at > ${since}`,
    sql<{ source: string; runs: number; success_pct: number | null; signals: number }[]>`
      select f.source, count(*)::int as runs,
        round((100.0 * count(*) filter (where f.ok) / nullif(count(*), 0))::numeric, 1)::float8 as success_pct,
        coalesce(sum(f.inserted), 0)::int as signals
      from public.feed_runs f where f.started_at > ${since} and f.finished_at is not null
      group by 1 order by 1`,
    sql<{ safe: number; need_help: number }[]>`
      select count(*) filter (where status = 'SAFE')::int as safe,
             count(*) filter (where status = 'NEED_HELP')::int as need_help
      from public.safe_checkins where created_at > ${since}`,
  ]);

  const statuses = toRecord(byStatus);
  const tiers = toRecord(byTier);
  const result: Analytics = {
    window_days: days,
    incidents: {
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
      by_status: Object.fromEntries(
        ['REPORTED', 'VERIFIED', 'ACTIVE', 'CONTAINED', 'RESOLVED', 'REJECTED'].map((s) => [s, statuses[s] ?? 0]),
      ) as Analytics['incidents']['by_status'],
      by_hazard: byHazard as Analytics['incidents']['by_hazard'],
      by_tier: Object.fromEntries(
        ['INFO', 'WATCH', 'WARNING', 'EMERGENCY'].map((t) => [t, tiers[t] ?? 0]),
      ) as Analytics['incidents']['by_tier'],
      per_day: perDay,
    },
    response: {
      median_time_to_verify_min: response?.median_verify ?? null,
      median_time_to_scene_min: assign?.median_scene ?? null,
      assignments_total: assign?.total ?? 0,
      sla_met_pct: assign?.sla_met_pct ?? null,
    },
    reports: {
      total: reports?.total ?? 0,
      with_photo: reports?.with_photo ?? 0,
      linked_to_verified_pct: reports?.verified_pct ?? null,
    },
    feeds,
    checkins: checkins ?? { safe: 0, need_help: 0 },
  };
  res.json(result);
});
