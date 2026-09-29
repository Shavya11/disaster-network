// Measures the evaluation metrics from report §17 against a LOCAL stack and writes docs/METRICS.md.
// Run: npm run metrics   (needs `npm run db:start`; never point this at production)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import autocannon from 'autocannon';
import { createClient } from '@supabase/supabase-js';
import type { HazardType } from '@dn/shared';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { sql } from '../src/lib/db.js';
import { refreshSettings } from '../src/lib/settings.js';
import { supabaseAdmin } from '../src/lib/supabase.js';
import { correlateReport, recomputeIncident, withCorrelationLock } from '../src/intelligence/correlate.js';

if (!/127\.0\.0\.1|localhost/.test(env.DATABASE_URL)) {
  throw new Error('Metrics create and delete test data; run them against the local database only.');
}
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) throw new Error('SUPABASE_PUBLISHABLE_KEY must be set (see `npx supabase status`)');

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
const r2 = (n: number) => Math.round(n * 100) / 100;
const startedAt = new Date();
const sections: string[] = [];

await refreshSettings();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// A throwaway citizen account for the API-level tests.
const email = `metrics-${Date.now()}@sim.dn`;
const password = randomUUID();
const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { full_name: 'Metrics Runner' },
});
if (createErr || !created.user) throw createErr;
const userId = created.user.id;
const anon = createClient(env.SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: session } = await anon.auth.signInWithPassword({ email, password });
const token = session.session!.access_token;

try {
  // ------------------------------------------------------------ M1 geofence latency
  console.log('M1 geofence…');
  await sql`drop table if exists public.metrics_bench_users`;
  await sql`create table public.metrics_bench_users (id serial primary key, loc extensions.geography(point, 4326))`;
  await sql`
    insert into public.metrics_bench_users (loc)
    select st_setsrid(st_makepoint(72.75 + random() * 0.35, 18.9 + random() * 0.4), 4326)::geography
    from generate_series(1, 100000)
  `;
  await sql`analyze public.metrics_bench_users`;
  const fence = 'POLYGON((72.865 19.055, 72.895 19.055, 72.895 19.085, 72.865 19.085, 72.865 19.055))';
  const timeQuery = async () => {
    const times: number[] = [];
    let matched = 0;
    for (let i = 0; i < 7; i++) {
      const [plan] = await sql<{ 'QUERY PLAN': [{ 'Execution Time': number }] }[]>`
        explain (analyze, format json)
        select count(*) from public.metrics_bench_users
        where st_covers(st_geogfromtext(${fence}), loc)
      `;
      times.push(plan!['QUERY PLAN'][0]['Execution Time']);
    }
    const [c] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.metrics_bench_users where st_covers(st_geogfromtext(${fence}), loc)`;
    matched = c!.n;
    return { ms: median(times.slice(2)), matched };
  };
  const noIndex = await timeQuery();
  await sql`create index metrics_bench_users_gix on public.metrics_bench_users using gist (loc)`;
  await sql`analyze public.metrics_bench_users`;
  const withIndex = await timeQuery();
  await sql`drop table public.metrics_bench_users`;
  sections.push(`## M1 — Geofence resolution, 100,000 users

Target: < 500 ms. Method: 100,000 random points over Greater Mumbai; count points inside a ~3 × 3 km polygon with \`ST_Covers\` (the same predicate the alert engine uses), median of 5 warm runs from \`EXPLAIN ANALYZE\`.

| | Execution time | Users matched |
|---|---:|---:|
| Without GiST index | ${r2(noIndex.ms)} ms | ${noIndex.matched} |
| With GiST index | ${r2(withIndex.ms)} ms | ${withIndex.matched} |
| **Speed-up** | **${r2(noIndex.ms / withIndex.ms)}×** | |

Result: **${withIndex.ms < 500 ? 'PASS' : 'FAIL'}**`);

  // ------------------------------------------------------------ M4 realtime latency
  console.log('M4 realtime…');
  const [inc] = await sql<{ id: string }[]>`
    insert into public.incidents (hazard_type, title, epicenter)
    values ('OTHER', 'metrics realtime probe', st_setsrid(st_makepoint(73.8, 18.5), 4326)::geography)
    returning id
  `;
  const waiters = new Map<string, (t: number) => void>();
  const channel = anon
    .channel('metrics-rt')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'incidents', filter: `id=eq.${inc!.id}` },
      (p) => waiters.get((p.new as { title: string }).title)?.(performance.now()))
    .subscribe();
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('realtime subscribe timeout')), 15_000);
    const check = setInterval(() => {
      if (channel.state === 'joined') { clearInterval(check); clearTimeout(t); resolve(); }
    }, 100);
  });
  // Warm-up: the first change after joining can be missed while the subscription settles.
  for (let attempt = 0; attempt < 10; attempt++) {
    const got = new Promise<number>((resolve) => waiters.set('warmup', resolve));
    await sql`update public.incidents set title = ${attempt % 2 ? 'warmup-x' : 'warmup'} where id = ${inc!.id}`;
    await sql`update public.incidents set title = 'warmup' where id = ${inc!.id}`;
    const ok = await Promise.race([got.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]);
    if (ok) break;
  }
  const rtLatencies: number[] = [];
  for (let i = 0; i < 20; i++) {
    const title = `metrics ${i}`;
    const received = new Promise<number>((resolve) => waiters.set(title, resolve));
    const t0 = performance.now();
    await sql`update public.incidents set title = ${title} where id = ${inc!.id}`;
    const t1 = await Promise.race([received, new Promise<number>((r) => setTimeout(() => r(NaN), 5000))]);
    if (!Number.isNaN(t1)) rtLatencies.push(t1 - t0);
  }
  await anon.removeChannel(channel);
  await sql`delete from public.incidents where id = ${inc!.id}`;
  sections.push(`## M4 — Real-time dashboard latency

Target: < 2 s. Method: a browser-equivalent Supabase client subscribed (with the public key, through RLS) to one incident; 20 committed updates; time from commit to event received.

| Events received | Median | p95 | Max |
|---:|---:|---:|---:|
| ${rtLatencies.length}/20 | ${r2(median(rtLatencies))} ms | ${r2(pct(rtLatencies, 95))} ms | ${r2(Math.max(...rtLatencies))} ms |

Result: **${rtLatencies.length === 20 && pct(rtLatencies, 95) < 2000 ? 'PASS' : 'FAIL'}**`);

  // ------------------------------------------------------------ M5 offline sync
  console.log('M5 offline sync…');
  const queue = Array.from({ length: 50 }, (_, i) => ({
    client_generated_id: randomUUID(),
    hazard_type: 'OTHER',
    lat: 18.52 + (i % 10) * 0.01,
    lon: 73.85 + Math.floor(i / 10) * 0.01,
    description: `metrics offline report ${i}`,
    reported_at: new Date(Date.now() - (50 - i) * 60_000).toISOString(),
  }));
  const bulk = async (reports: typeof queue) => {
    const res = await fetch(`${base}/reports/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reports }),
    });
    const body = (await res.json()) as { results: { status: string }[] };
    const count = (s: string) => body.results.filter((r) => r.status === s).length;
    return { http: res.status, created: count('created'), duplicate: count('duplicate'), error: count('error') };
  };
  // Connection drops after the first 20 were delivered; the client then retries the whole queue twice.
  const partial = await bulk(queue.slice(0, 20));
  const retry1 = await bulk(queue);
  const retry2 = await bulk(queue);
  const [stored] = await sql<{ n: number; distinct_ids: number }[]>`
    select count(*)::int as n, count(distinct client_generated_id)::int as distinct_ids
    from public.reports where client_generated_id in ${sql(queue.map((q) => q.client_generated_id))}
  `;
  sections.push(`## M5 — Offline synchronisation

Target: 100 % delivered, 0 duplicates. Method: 50 reports queued offline; the connection drops after 20 are delivered; the client then re-sends the full queue twice via \`POST /reports/bulk\`.

| Attempt | HTTP | Created | Duplicate (ignored) | Errors |
|---|---:|---:|---:|---:|
| First 20 | ${partial.http} | ${partial.created} | ${partial.duplicate} | ${partial.error} |
| Full queue, retry 1 | ${retry1.http} | ${retry1.created} | ${retry1.duplicate} | ${retry1.error} |
| Full queue, retry 2 | ${retry2.http} | ${retry2.created} | ${retry2.duplicate} | ${retry2.error} |

Rows stored: **${stored!.n}** (distinct ids ${stored!.distinct_ids}) of 50.

Result: **${stored!.n === 50 && stored!.distinct_ids === 50 ? 'PASS' : 'FAIL'}**`);

  // ------------------------------------------------------------ M6 correlation accuracy
  console.log('M6 correlation…');
  const events: { name: string; hazard: HazardType; lat: number; lon: number; spreadKm: number }[] = [
    { name: 'Flood, Kurla (Mumbai)', hazard: 'FLOOD', lat: 19.072, lon: 72.88, spreadKm: 3 },
    { name: 'Flood, Yamuna bank (Delhi)', hazard: 'FLOOD', lat: 28.66, lon: 77.25, spreadKm: 3 },
    { name: 'Building collapse, Dharavi', hazard: 'BUILDING_COLLAPSE', lat: 19.04, lon: 72.855, spreadKm: 0.12 },
    { name: 'Building collapse, 2 km north', hazard: 'BUILDING_COLLAPSE', lat: 19.058, lon: 72.855, spreadKm: 0.12 },
    { name: 'Fire, Andheri', hazard: 'FIRE', lat: 19.119, lon: 72.846, spreadKm: 0.3 },
    { name: 'Gas leak, Thane', hazard: 'GAS_LEAK', lat: 19.218, lon: 72.978, spreadKm: 0.3 },
  ];
  const jitter = (lat: number, lon: number, km: number) => {
    const r = km * Math.sqrt(Math.random());
    const a = Math.random() * 2 * Math.PI;
    return { lat: lat + (r / 111) * Math.cos(a), lon: lon + (r / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a) };
  };
  const synthetic = Array.from({ length: 200 }, (_, i) => {
    const e = events[i % events.length]!;
    return { event: e.name, hazard: e.hazard, ...jitter(e.lat, e.lon, e.spreadKm) };
  }).sort(() => Math.random() - 0.5);

  const assigned: { event: string; incident: string; report: string }[] = [];
  for (const s of synthetic) {
    const r = await withCorrelationLock(async (db) => {
      const [row] = await db<{ id: string }[]>`
        insert into public.reports (user_id, hazard_type, location, description, client_generated_id, reported_at)
        values (${userId}, ${s.hazard}, st_setsrid(st_makepoint(${s.lon}, ${s.lat}), 4326)::geography,
                'metrics correlation', ${randomUUID()}, now())
        returning id
      `;
      return { report: row!.id, incident: await correlateReport(db, row!.id) };
    });
    assigned.push({ event: s.event, ...r });
  }
  const rows = events.map((e) => {
    const mine = assigned.filter((a) => a.event === e.name);
    const counts = new Map<string, number>();
    for (const a of mine) counts.set(a.incident, (counts.get(a.incident) ?? 0) + 1);
    const [majority, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return { event: e.name, reports: mine.length, incidents: counts.size, majority, correct: n };
  });
  const majorities = rows.map((r) => r.majority);
  const merged = majorities.length - new Set(majorities).size;
  const correct = rows.reduce((s, r) => s + r.correct, 0);
  const accuracy = (100 * correct) / synthetic.length;
  sections.push(`## M6 — Correlation accuracy

Target: ≥ 90 % correctly grouped. Method: 200 synthetic citizen reports from 6 known events, shuffled and submitted one by one. Two of the events are the same hazard type only 2 km apart and must stay separate. A report counts as correct when it lands in the incident that holds the majority of its event's reports.

| Event | Reports | Incidents used | In majority incident |
|---|---:|---:|---:|
${rows.map((r) => `| ${r.event} | ${r.reports} | ${r.incidents} | ${r.correct} |`).join('\n')}

Distinct events wrongly merged into one incident: **${merged}**. Accuracy: **${r2(accuracy)} %**.

Result: **${accuracy >= 90 && merged === 0 ? 'PASS' : 'FAIL'}**`);

  // ------------------------------------------------------------ M8 load
  console.log('M8 load…');
  const endpoints = [
    '/incidents',
    '/signals?limit=200',
    '/shelters/nearby?lat=19.07&lon=72.88&radius_km=5',
  ];
  // Separate API process, so the load generator doesn't share the server's event loop.
  const loadPort = 4100 + Math.floor(Math.random() * 500);
  const apiProc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(loadPort) },
    stdio: 'ignore',
  });
  const loadBase = `http://127.0.0.1:${loadPort}`;
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${loadBase}/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const loadRows: string[] = [];
  let loadPass = true;
  for (const path of endpoints) {
    const r = await autocannon({ url: `${loadBase}${path}`, connections: 100, duration: 10 });
    const errors = r.errors + r.non2xx;
    if (errors > 0 || r.latency.p99 > 2000) loadPass = false;
    loadRows.push(`| \`GET ${path}\` | ${r.requests.total} | ${r2(r.requests.average)} | ${r.latency.p50} ms | ${r.latency.p97_5} ms | ${r.latency.p99} ms | ${errors} |`);
  }
  apiProc.kill();
  sections.push(`## M8 — Concurrent load

Target: stable p95 latency under load. Method: [autocannon](https://github.com/mcollina/autocannon), 100 concurrent connections for 10 s per endpoint, against a separate API process on the development machine with the local database. Free-tier cloud hosting will be slower; re-run against the deployed URL for the final figure.

| Endpoint | Requests | Req/s | p50 | p97.5 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|
${loadRows.join('\n')}

Result: **${loadPass ? 'PASS' : 'FAIL'}** (no errors, p99 < 2 s)`);
} finally {
  // ------------------------------------------------------------ cleanup
  const touched = await sql<{ incident_id: string }[]>`
    select distinct incident_id from public.reports where user_id = ${userId} and incident_id is not null`;
  await sql`delete from public.reports where user_id = ${userId}`;
  await sql`
    delete from public.incidents i
    where i.id in ${sql(touched.map((t) => t.incident_id).concat(['00000000-0000-0000-0000-000000000000']))}
      and i.created_at >= ${startedAt}
      and not exists (select 1 from public.reports r where r.incident_id = i.id)
      and not exists (select 1 from public.raw_signals s where s.incident_id = i.id)
  `;
  const remaining = await sql<{ id: string }[]>`
    select id from public.incidents where id in ${sql(touched.map((t) => t.incident_id).concat(['00000000-0000-0000-0000-000000000000']))}`;
  for (const r of remaining) await withCorrelationLock((db) => recomputeIncident(db, r.id));
  await supabaseAdmin.auth.admin.deleteUser(userId);
  server.close();
}

const doc = `# Evaluation Metrics

Measured ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on the local development stack
(Node ${process.version}, PostgreSQL 17 + PostGIS via Supabase CLI in Docker). Re-generate with \`npm run metrics\`.

Metric numbering follows report §17. M2/M3 (alert delivery to devices) wait for the external
channels; M7 (7-day ingestion reliability) is read from \`GET /admin/analytics\` → \`feeds\` once the
scheduled job has been running in the cloud; M9/M10 are measured on the frontend.

${sections.join('\n\n')}
`;
writeFileSync(new URL('../../../docs/METRICS.md', import.meta.url), doc);
console.log(doc);
await sql.end();
process.exit(0);
