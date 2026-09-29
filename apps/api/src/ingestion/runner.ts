import { sql } from '../lib/db.js';
import { createFirmsAdapter } from './adapters/firms.js';
import { gdacsAdapter } from './adapters/gdacs.js';
import { openMeteoAdapter } from './adapters/openMeteo.js';
import { usgsAdapter } from './adapters/usgs.js';
import type { FeedAdapter, NormalizedSignal } from './types.js';

// Adding a data source = write an adapter and register it here (FR-22).
// FIRMS is enabled only when a (free) key is configured.
const firmsKey = process.env.FIRMS_MAP_KEY;
export const ADAPTERS: Record<string, FeedAdapter> = Object.fromEntries(
  [usgsAdapter, openMeteoAdapter, gdacsAdapter, ...(firmsKey ? [createFirmsAdapter(firmsKey)] : [])]
    .map((a) => [a.source, a]),
);

export interface FeedRunResult {
  source: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  error?: string;
  ms: number;
}

const BATCH_SIZE = 200;

async function upsertSignals(source: string, signals: NormalizedSignal[]) {
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const rows = signals.slice(i, i + BATCH_SIZE).map((s) => ({
      source,
      source_event_id: s.source_event_id,
      hazard_type: s.hazard_type,
      location: `SRID=4326;POINT(${s.lon} ${s.lat})`,
      magnitude: s.magnitude,
      title: s.title,
      occurred_at: s.occurred_at,
      payload: sql.json(s.payload as never),
    }));

    // Rows whose payload is unchanged are skipped entirely, so re-polling is cheap.
    const result = await sql<{ inserted: boolean }[]>`
      insert into public.raw_signals ${sql(rows)}
      on conflict (source, source_event_id) do update set
        hazard_type = excluded.hazard_type,
        location    = excluded.location,
        magnitude   = excluded.magnitude,
        title       = excluded.title,
        occurred_at = excluded.occurred_at,
        payload     = excluded.payload
      where raw_signals.payload is distinct from excluded.payload
         or raw_signals.magnitude is distinct from excluded.magnitude
      returning (xmax = 0) as inserted
    `;
    for (const r of result) (r.inserted ? inserted++ : updated++);
  }
  return { inserted, updated };
}

export async function runFeed(adapter: FeedAdapter): Promise<FeedRunResult> {
  const started = Date.now();
  const [run] = await sql<{ id: number }[]>`
    insert into public.feed_runs (source) values (${adapter.source}) returning id
  `;

  let result: FeedRunResult;
  try {
    const signals = await adapter.fetch();
    const { inserted, updated } = await upsertSignals(adapter.source, signals);
    result = { source: adapter.source, ok: true, fetched: signals.length, inserted, updated, ms: 0 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    result = { source: adapter.source, ok: false, fetched: 0, inserted: 0, updated: 0, error, ms: 0 };
  }
  result.ms = Date.now() - started;

  await sql`
    update public.feed_runs set
      finished_at = now(), ok = ${result.ok}, fetched = ${result.fetched},
      inserted = ${result.inserted}, updated = ${result.updated}, error = ${result.error ?? null}
    where id = ${run!.id}
  `;
  return result;
}

// One failing feed never blocks the others (NFR-4).
export async function runFeeds(sources: string[]): Promise<FeedRunResult[]> {
  return Promise.all(sources.map((s) => runFeed(ADAPTERS[s]!)));
}
