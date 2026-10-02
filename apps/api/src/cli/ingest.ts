// Usage: node dist/cli/ingest.js [all | usgs | open-meteo | gdacs ...]
import { sql } from '../lib/db.js';
import { refreshSettings } from '../lib/settings.js';
import { ADAPTERS, runFeeds } from '../ingestion/runner.js';
import { correlateSignals, recomputeOpenIncidents } from '../intelligence/correlate.js';
import { fillPlaceNames } from '../lib/geocode.js';

const args = process.argv.slice(2);
const sources = args.length === 0 || args.includes('all') ? Object.keys(ADAPTERS) : args;

const unknown = sources.filter((s) => !ADAPTERS[s]);
if (unknown.length) {
  console.error(`Unknown source(s): ${unknown.join(', ')}. Known: ${Object.keys(ADAPTERS).join(', ')}`);
  process.exit(2);
}

await refreshSettings();
const results = await runFeeds(sources);
console.table(results);

const correlation = await correlateSignals();
const refreshed = await recomputeOpenIncidents();
console.log(
  `Correlation: ${correlation.linked} signals linked, ${correlation.created} new incidents, ` +
    `${refreshed} open incidents rescored`,
);
const named = await fillPlaceNames();
if (named) console.log(`Place names filled: ${named}`);
await sql.end();

process.exitCode = results.every((r) => r.ok) ? 0 : 1;
