# API Contract — Frontend ↔ Backend

Status legend: ✅ live · 🔜 coming in the V1 session noted · all shapes are final unless marked *draft*.

## 1. How the frontend talks to the system

| What | Goes to | How |
|---|---|---|
| Sign up, log in, log out, session refresh | **Supabase Auth** directly | `@supabase/supabase-js` in the browser |
| Live map / dashboard updates | **Supabase Realtime** directly | `supabase.channel(...).on('postgres_changes', ...)` |
| Everything else (reads and all writes) | **Our API** | `fetch` with `Authorization: Bearer <access_token>` |

The browser **never writes to the database directly**; all writes go through the API. Row-level security enforces this.

### Environment values (frontend `.env`)

```
VITE_API_URL=http://localhost:4000
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

These are the **local** values. **Production** (live):

```
VITE_API_URL=https://disaster-network-api.onrender.com
VITE_SUPABASE_URL=https://gzpjzmsgvictvoqgauda.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<ask the backend owner — safe to ship in the browser>
```

The production demo accounts use a different password; ask the backend owner.

### Getting the token

```ts
const { data } = await supabase.auth.getSession();
const token = data.session?.access_token;
fetch(`${API_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
```

Sign-up should pass the name so the profile is created with it:

```ts
supabase.auth.signUp({ email, password, options: { data: { full_name } } });
```

Everyone who self-registers is a **CITIZEN**. Other roles are assigned by an admin.

### Demo accounts (local)

| Role | Email | Password |
|---|---|---|
| Citizen | citizen@demo.dn | Demo@12345 |
| Responder | responder@demo.dn | Demo@12345 |
| Coordinator | coordinator@demo.dn | Demo@12345 |
| Admin | admin@demo.dn | Demo@12345 |

## 2. Shared types

All request/response types and enums live in `packages/shared` (`@dn/shared`). Import from there rather than redefining them:

```ts
import type { Incident, Profile } from '@dn/shared';
import { HAZARD_TYPES, SEVERITY_TIERS, updateProfileSchema } from '@dn/shared';
```

- **Coordinates** are always `{ lat, lon }` objects in JSON.
- **Areas** (geofences, affected areas) are GeoJSON `Polygon`, coordinate order `[lon, lat]` (GeoJSON standard — Leaflet's `toGeoJSON()` produces this).
- **Timestamps** are ISO-8601 strings in UTC.

Enums:

| Enum | Values |
|---|---|
| Role | `CITIZEN` `RESPONDER` `COORDINATOR` `ADMIN` |
| Hazard | `EARTHQUAKE` `FLOOD` `CYCLONE` `STORM` `WILDFIRE` `HEATWAVE` `LANDSLIDE` `BUILDING_COLLAPSE` `GAS_LEAK` `MEDICAL` `FIRE` `ROAD_BLOCKAGE` `OTHER` |
| Incident status | `REPORTED` `VERIFIED` `ACTIVE` `CONTAINED` `RESOLVED` `REJECTED` |
| Severity tier | `INFO` `WATCH` `WARNING` `EMERGENCY` |
| Alert channel | `TELEGRAM` `EMAIL` `SMS` `PUSH` |
| Delivery status | `PENDING` `SENT` `FAILED` `ACKNOWLEDGED` |

## 3. Errors

Every error response has this shape:

```json
{ "error": "Validation failed", "details": { "fieldErrors": { "lat": ["Number must be less than or equal to 90"] } } }
```

| Code | Meaning |
|---|---|
| 400 | Invalid input — `details.fieldErrors` maps field → messages |
| 401 | Missing or expired token — refresh the session / send to login |
| 403 | Logged in but role not allowed |
| 404 | Not found |

## 4. Endpoints

### Health
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /health` | – | `{ ok, postgis, time }` |

### Current user
| | Method & path | Auth | Body → Response |
|---|---|---|---|
| ✅ | `GET /me` | any | → `Profile` |
| ✅ | `PATCH /me` | any | `{ full_name?, phone?, alert_radius_m?, channels?, telegram_chat_id?, language? }` → `Profile` |
| ✅ | `PUT /me/location` | any | `{ lat, lon }` → `Profile`. Call on app open and when position changes meaningfully. |

### Incidents
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /incidents` | public | Query: `bbox=minLon,minLat,maxLon,maxLat` `status` `hazard` `since` (ISO, on last activity) `limit` (≤500). Sorted most severe first. Rejected ones hidden unless `status=REJECTED`. → `Incident[]` |
| ✅ | `GET /incidents/:id` | public | → `Incident` |
| ✅ | `GET /incidents/:id/signals` | public | Feed evidence → `Signal[]` |
| ✅ | `GET /incidents/:id/reports` | responder, coordinator, admin | Citizen evidence → `Report[]` |
| ✅ | `POST /incidents/:id/verify` | coordinator, admin | `{ tier?, note? }` → `Incident`. Only from `REPORTED`. `tier` optionally overrides the computed tier. |
| ✅ | `POST /incidents/:id/reject` | coordinator, admin | `{ reason }` (min 3 chars) → `Incident` |
| ✅ | `PATCH /incidents/:id/status` | coordinator, admin | `{ status, note? }` → `Incident`. 409 with `details.allowed` on an illegal move. |
| ✅ | `PATCH /incidents/:id` | coordinator, admin | `{ title?, description?, tier? }` — `tier: null` removes an override |

**Lifecycle:** `REPORTED` → verify → `VERIFIED` → `ACTIVE` ⇄ `CONTAINED` → `RESOLVED` (can reopen to `ACTIVE`). Reject is possible from `REPORTED`/`VERIFIED`/`ACTIVE`; a rejected incident can go back to `REPORTED`.

**Two different things to display:**
- `severity_tier` / `severity_score` = **how urgent** (colour the marker by this; never colour alone — add a label/icon).
- `alert_permission` = **the highest tier an alert may be sent at**. `INFO` means "no alerts yet". The alert composer (S4) should cap the tier picker at this value.

`severity_breakdown` explains the score (H, E, V, C, which factors applied, why permission was granted). Show it in the incident detail panel, e.g. "Score 50 = Hazard 0.60 · Exposure 1.00 · Vulnerability 0 × Confidence 0.73 — corroborated by 3 reports".

### Live feed signals
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /signals` | public | Raw events from the live feeds → `Signal[]`. Query: `bbox` `since` (default: last 3 days; ongoing events included) `source` (`usgs` \| `open-meteo` \| `gdacs`) `hazard` `limit` (≤1000). |
| ✅ | `GET /admin/feeds/health` | coordinator, admin | → `FeedHealth[]` — last run, last error, 24 h success rate, counts per source |
| ✅ | `POST /admin/feeds/:source/poll` | admin | "Poll now" button → `{ source, ok, fetched, inserted, updated, ms, error? }` |

Useful `payload` fields for map popups: USGS → `place`, `url`, `depth_km`, `tsunami`; GDACS → `alert_level` (`Green`/`Orange`/`Red`), `country`, `severity_text`, `report_url`; Open-Meteo → `city`, `forecast_date`, `value`, `unit`.

Feeds refresh every 10 minutes. Signals are raw data; signals inside India are grouped into **incidents**, which is what the main map and dashboard should focus on.

### Citizen reports
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `POST /reports` | any | `{ client_generated_id (uuid), hazard_type, lat, lon, description?, people_affected?, photo_url?, reported_at (ISO) }` → `Report` with `incident_id`. **201** new, **200** if that `client_generated_id` was already received. 429 after 30 reports/hour. |
| ✅ | `POST /reports/bulk` | any | `{ reports: [...] }` (≤50) → `{ results: [{ client_generated_id, status: 'created'\|'duplicate'\|'error', id?, error? }] }`. Remove `created` and `duplicate` from the offline queue; show `error` ones to the user. |
| ✅ | `GET /reports/mine` | any | → `Report[]` with `incident_status` |
| ✅ | Photo upload | any | Upload directly to Supabase Storage, see below |

**Photo upload:** upload to bucket `report-photos` at path `<user id>/<any name>.jpg` (jpeg/png/webp, ≤5 MB), then send the public URL as `photo_url`. Uploads to any other folder are refused, and the API rejects photo URLs outside the user's folder.

```ts
const path = `${user.id}/${crypto.randomUUID()}.jpg`;
await supabase.storage.from('report-photos').upload(path, file);
const photo_url = supabase.storage.from('report-photos').getPublicUrl(path).data.publicUrl;
```

**Offline:** generate `client_generated_id` with `crypto.randomUUID()` when the user taps submit, store the report in IndexedDB, and send via `/reports/bulk` when back online. Duplicates are ignored server-side. `reported_at` must be within the last 7 days.

**After submitting**, show the user "Report received" and, once the linked incident is verified, "Verified by authorities" (poll `/reports/mine` or listen on the `reports` realtime channel).

### "I'm safe" check-ins
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `POST /checkins` | any | `{ status: 'SAFE'\|'NEED_HELP', incident_id?, lat?, lon?, note? }` → `Checkin`. Without `lat/lon` the user's last known location is used; without `incident_id` it links to the incident whose area contains the user. |
| ✅ | `GET /checkins/mine` | any | → `Checkin[]` |
| ✅ | `GET /checkins/summary?incident_id=` | responder, coordinator, admin | → `CheckinSummary` (latest status per person, list of who needs help) |

### Alerts (in-app)
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `POST /alerts/preview?incident_id=` | coordinator, admin | `{ geofence }` → `AlertPreview { recipient_count, area_km2, max_tier }`. Call while the coordinator draws (debounce ~300 ms). |
| ✅ | `POST /alerts` | coordinator, admin | `{ incident_id?, tier, title, body, geofence }` → `Alert`. **403** with `details.max_tier` if the tier exceeds what's allowed. |
| ✅ | `GET /alerts?incident_id=` | coordinator, admin | → `Alert[]` with `recipient_count`, `acknowledged_count`, `skipped_duplicates` |
| ✅ | `GET /alerts/:id` · `GET /alerts/:id/deliveries` | coordinator, admin | Per-recipient status |
| ✅ | `GET /alerts/inbox` | any | → `InboxAlert[]` — the citizen's alert list |
| ✅ | `POST /alerts/:id/acknowledge` | any | 204 — "I've seen this" button |

- `geofence` is a GeoJSON **Polygon** (rings closed, `[lon, lat]`), max 25,000 km². Pre-fill it with the incident's `affected_area`.
- **Tier limits:** with an incident → up to its `alert_permission`; without an incident → `WATCH` at most. Disable higher options in the tier picker.
- The same person isn't alerted twice about one incident within an hour unless the tier goes up (`skipped_duplicates`).
- Only the in-app channel is active. Email / WhatsApp / Telegram / SMS will be added later without changing these endpoints.
- New alerts for the user arrive on the `deliveries` realtime channel → refetch `/alerts/inbox` and show a banner.

### Response teams
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /teams` | responder, coordinator, admin | → `Team[]` |
| ✅ | `GET /teams?near_incident=<id>` | same | Available teams first, then nearest — for the "Assign team" picker (`distance_km`) |
| ✅ | `GET /teams/mine` | responder | The responder's own team |
| ✅ | `POST /teams` · `PATCH /teams/:id` | coordinator, admin | `{ name, type, base: {lat, lon}, member_count }` / `{ name?, status?, member_count? }` |
| ✅ | `PUT /teams/:id/location` | team member, coordinator | `{ lat, lon }` — responder app sends position every ~30 s while on a job |
| ✅ | `POST /teams/:id/members` · `DELETE /teams/:id/members/:userId` | coordinator, admin | `{ user_id }` (must be a RESPONDER) |

### Assignments (dispatch)
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `POST /assignments` | coordinator, admin | `{ incident_id, team_id, instructions?, sla_minutes? }` → `Assignment`. Incident must be verified; team must be `AVAILABLE`. Default SLA: EMERGENCY 30 min, WARNING 60, WATCH 120, INFO 240. A `VERIFIED` incident becomes `ACTIVE`. |
| ✅ | `GET /assignments?incident_id=&team_id=&status=&open=true` | coordinator, admin | → `Assignment[]` (open first, soonest deadline first) |
| ✅ | `GET /assignments/mine` | responder | The team's jobs |
| ✅ | `GET /assignments/:id` | team member, coordinator | |
| ✅ | `PATCH /assignments/:id/status` | team member, coordinator | `{ status, note? }`. Order: `ASSIGNED → ACKNOWLEDGED → EN_ROUTE → ON_SCENE → COMPLETED`. Only coordinators can `CANCELLED`. 409 with `details.allowed`. |

`sla_breached` is true once the team is (or would be) on scene after `sla_deadline` — show a red timer.

### Resources
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /resources?type=&lat=&lon=` | responder, coordinator, admin | → `Resource[]`; with `lat/lon`, nearest depot first |
| ✅ | `POST /resources` · `PATCH /resources/:id` | coordinator, admin | Create stock / change total `{ quantity }` |
| ✅ | `POST /resources/allocate` | coordinator, admin | `{ resource_id, incident_id, quantity }` — 409 if not enough available |
| ✅ | `GET /resources/allocations?incident_id=` | responder, coordinator, admin | → `ResourceAllocation[]` |
| ✅ | `POST /resources/allocations/:id/release` | coordinator, admin | Return stock |

### Shelters & hospitals
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /shelters/nearby?lat=&lon=&radius_km=&limit=` | public | → `Shelter[]`, open ones first, with `distance_km`, `spaces_left` |
| ✅ | `GET /shelters?kind=` | public | All (`kind`: `shelter`, `hospital`, `community_centre`) |
| ✅ | `POST /shelters` | coordinator, admin | |
| ✅ | `PATCH /shelters/:id` | responder, coordinator, admin | `{ current_occupancy?, capacity?, status?, ... }`. Becomes `FULL` automatically at capacity. |

Seeded from OpenStreetMap. Capacities without OSM data are estimates.

### Road closures & routing
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /roads/blocked` | public | → `BlockedRoad[]` (GeoJSON LineString) — draw in red on the map |
| ✅ | `POST /roads/block` | coordinator, admin | `{ coordinates: [[lon, lat], ...], reason, incident_id? }` — from a drawn polyline |
| ✅ | `POST /roads/:id/clear` | coordinator, admin | |
| ✅ | `GET /routing/path?from=lat,lon&to=lat,lon` | any logged-in | → `RouteResult` avoiding active closures. If `blocked: true`, no clear route exists — show a warning with the route. Takes 1–5 s. |

### Admin
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /admin/users?role=&q=` | coordinator, admin | → `AdminUser[]` |
| ✅ | `PATCH /admin/users/:id/role` | admin | `{ role }` — can't change own role |
| ✅ | `GET /admin/audit?entity_type=&entity_id=&actor_id=&before_id=` | admin | → `AuditEntry[]`, newest first; page with `before_id` = last id |
| ✅ | `GET /admin/analytics?days=30` | coordinator, admin | → `Analytics` (charts for the analytics page) |
| ✅ | `GET /admin/settings` | coordinator, admin | Current value, default, and who changed it, per setting |
| ✅ | `PUT /admin/settings/:key` · `DELETE /admin/settings/:key` | admin | Change / reset. Keys: `weather_thresholds`, `severity_weights`, `alert_policy`, `correlation`. Open incidents are rescored. |
| ✅ | `POST /admin/simulate` | admin | `{ scenario: 'mumbai-flood' \| 'delhi-earthquake' \| 'building-collapse' }` → `SimulationResult` — demo button |
| ✅ | `DELETE /admin/simulate` | admin | Removes all simulated data |

## 5. Realtime

Subscribe directly via Supabase. Tables published: `incidents`, `reports`, `alerts`, `deliveries`, `teams`, `assignments`, `shelters`, `safe_checkins`, `blocked_roads`. RLS applies, so each user only receives rows they're allowed to see.

```ts
supabase
  .channel('incidents')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => {
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
  })
  .subscribe();
```

Realtime payloads contain raw database columns (locations arrive as PostGIS hex, not `{lat, lon}`). **Use the event as a signal to refetch from the API**, not as the data itself.

## 6. Running the backend locally

Requires Node 24 and Docker Desktop.

```bash
npm install
npm run db:start          # local Supabase (first run downloads images)
cp apps/api/.env.example apps/api/.env   # fill SUPABASE_SECRET_KEY from `npx supabase status`
npm run seed:users        # 4 demo logins
npm run seed:demo         # teams, resources, shelters from OpenStreetMap
npm run ingest            # pull live feeds once
npm run dev               # API on http://localhost:4000
```

Supabase Studio (database browser): http://127.0.0.1:54323

## 7. Production notes

- The API runs on Render's free plan and **sleeps after 15 minutes without traffic**. The first request after that takes ~30–60 s; show a "waking up the server…" state instead of failing. Calling `GET /health` when the app opens warms it up.
- Add your deployed frontend URL to the API's `CORS_ORIGINS` (ask the backend owner) or the browser will block requests.
