# Intelligent Disaster Monitoring and Emergency Communication Network

**RAKSHAK** — a zero-cost disaster monitoring platform: it pulls live hazard data (USGS, Open-Meteo, GDACS,
optional NASA FIRMS), merges it with geotagged citizen reports into scored incidents, and gives a control room
the tools to verify, dispatch teams, manage resources and shelters, close roads, and alert people inside a
drawn area. The web app has four role-based consoles (coordinator, citizen, responder, admin) on a live
MapLibre map.

| Document | What it covers |
|---|---|
| [docs/API-CONTRACT.md](docs/API-CONTRACT.md) | Every endpoint, for the frontend |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, data model, flows, state machines, role permissions |
| [docs/METRICS.md](docs/METRICS.md) | Measured evaluation metrics (report §17) |
| [INITIAL-PROJECT-REPORT.md](INITIAL-PROJECT-REPORT.md) · [Severity-Model.pdf](Severity-Model.pdf) | Design report and severity model |

## Stack

Node.js 24 · TypeScript · Express · PostgreSQL + PostGIS (Supabase) · Supabase Auth, Realtime, Storage ·
React + Vite · MapLibre GL with OpenFreeMap tiles · GitHub Actions · Render. All free tiers.

```
apps/web/          React web app (login + coordinator, citizen, responder and admin consoles)
apps/api/          REST API, ingestion, correlation + severity engine, routing, simulator, metrics
packages/shared/   Types and zod schemas shared with the frontend (@dn/shared)
supabase/          Migrations (schema, PostGIS, RLS, audit log)
scripts/           Demo data seeding
.github/workflows/ CI and scheduled ingestion
```

## Run locally

Requires Node 24 and Docker Desktop.

```bash
npm install
npm run db:start                          # local Supabase in Docker
cp apps/api/.env.example apps/api/.env    # keys from `npx supabase status`
npm run seed:users                        # demo logins (password Demo@12345)
npm run seed:demo                         # teams, resources, shelters from OpenStreetMap
npm run ingest                            # pull live feeds once
npm run dev                               # API on http://localhost:4000
cp apps/web/.env.example apps/web/.env    # in a second terminal
npm run dev:web                           # web app on http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm test -w @dn/api` | Severity model unit tests |
| `npm run typecheck` | Type-check shared package, API and web app |
| `npm run metrics` | Measure M1, M4, M5, M6, M8 against the local stack → `docs/METRICS.md` |
| `npm run db:reset` | Recreate the local database from migrations |

Demo accounts: `citizen@demo.dn`, `responder@demo.dn`, `coordinator@demo.dn`, `admin@demo.dn`.
Pick one on the login screen. As admin, **Admin → Scenario simulator → Surat flood** injects a scripted
disaster; then verify, alert and dispatch it from the Coordinator Console, and follow the task as the responder.
**Clear** removes the simulated data.
