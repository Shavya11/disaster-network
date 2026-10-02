import { existsSync, readFileSync } from 'node:fs';
import { Router } from 'express';
import type { MetricResult, MetricsReport } from '@dn/shared';
import { sql } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminMetricsRouter = Router();
adminMetricsRouter.use(requireAuth, requireRole('COORDINATOR', 'ADMIN'));

// Written by `npm run metrics`; same relative path from src/routes and dist/routes.
const RESULTS_FILE = new URL('../../metrics/results.json', import.meta.url);

adminMetricsRouter.get('/', async (_req, res) => {
  const measured = existsSync(RESULTS_FILE)
    ? (JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as MetricsReport['measured'])
    : null;

  const [[verify], [delivery], feeds] = await Promise.all([
    sql<{ median_sec: number | null; n: number }[]>`
      select round((percentile_cont(0.5) within group (order by secs))::numeric, 1)::float8 as median_sec,
             count(*)::int as n
      from (
        select extract(epoch from min(a.created_at) - i.verified_at) as secs
        from public.incidents i
        join public.alerts a on a.incident_id = i.id and a.created_at >= i.verified_at
        where i.verified_at > now() - interval '30 days'
        group by i.id, i.verified_at
      ) x`,
    sql<{ pct: number | null; n: number }[]>`
      select round((100.0 * count(*) filter (where status in ('SENT', 'ACKNOWLEDGED'))
               / nullif(count(*), 0))::numeric, 1)::float8 as pct, count(*)::int as n
      from public.deliveries where created_at > now() - interval '30 days'`,
    sql<{ source: string; runs: number; pct: number | null; since: Date }[]>`
      select source, count(*)::int as runs,
        round((100.0 * count(*) filter (where ok) / nullif(count(*), 0))::numeric, 2)::float8 as pct,
        min(started_at) as since
      from public.feed_runs
      where started_at > now() - interval '7 days' and finished_at is not null
      group by source order by source`,
  ]);

  const live: MetricResult[] = [
    {
      id: 'M2',
      label: 'Verification → alert in people’s inbox (median, last 30 days)',
      target: 'under 30 s',
      value: verify?.median_sec == null ? 'no verified incidents with alerts yet' : `${verify.median_sec} s over ${verify.n} incidents`,
      pass: verify?.median_sec == null ? null : verify.median_sec < 30,
    },
    {
      id: 'M3',
      label: 'Alerts delivered (in-app channel, last 30 days)',
      target: 'above 95%',
      value: delivery?.pct == null ? 'no alerts sent yet' : `${delivery.pct}% of ${delivery.n} deliveries`,
      pass: delivery?.pct == null ? null : delivery.pct > 95,
    },
    ...feeds.map((f): MetricResult => {
      const days = (Date.now() - +f.since) / 86_400_000;
      return {
        id: 'M7',
        label: `Ingestion reliability — ${f.source} (last 7 days)`,
        target: 'above 99% over 7 days',
        value: `${f.pct}% of ${f.runs} runs${days < 6.9 ? ` (only ${days.toFixed(1)} days of data so far)` : ''}`,
        pass: f.pct == null || days < 6.9 ? null : f.pct > 99,
      };
    }),
  ];

  const report: MetricsReport = { measured, live };
  res.json(report);
});
