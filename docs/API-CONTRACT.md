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

These are the **local** values. Production values will be shared once the cloud project is set up.

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
| ✅ | `GET /incidents` | public | Query: `bbox=minLon,minLat,maxLon,maxLat` `status` `hazard` `since` (ISO) `limit` (≤500). Rejected ones hidden unless `status=REJECTED`. → `Incident[]` |
| ✅ | `GET /incidents/:id` | public | → `Incident` |
| 🔜 S3 | `POST /incidents/:id/verify` | coordinator | `{ tier }` → `Incident` |
| 🔜 S3 | `POST /incidents/:id/reject` | coordinator | `{ reason }` → `Incident` |
| 🔜 S3 | `PATCH /incidents/:id/status` | coordinator | `{ status }` → `Incident` |
| 🔜 S3 | `GET /incidents/:id/reports` | responder, coordinator | → `Report[]` |

### Live feed signals
| | Method & path | Auth | Notes |
|---|---|---|---|
| ✅ | `GET /signals` | public | Raw events from the live feeds → `Signal[]`. Query: `bbox` `since` (default: last 3 days; ongoing events included) `source` (`usgs` \| `open-meteo` \| `gdacs`) `hazard` `limit` (≤1000). |
| ✅ | `GET /admin/feeds/health` | coordinator, admin | → `FeedHealth[]` — last run, last error, 24 h success rate, counts per source |
| ✅ | `POST /admin/feeds/:source/poll` | admin | "Poll now" button → `{ source, ok, fetched, inserted, updated, ms, error? }` |

Useful `payload` fields for map popups: USGS → `place`, `url`, `depth_km`, `tsunami`; GDACS → `alert_level` (`Green`/`Orange`/`Red`), `country`, `severity_text`, `report_url`; Open-Meteo → `city`, `forecast_date`, `value`, `unit`.

Feeds refresh every 30 minutes. Signals are raw data; in S3 they get grouped into **incidents**, which is what the main map and dashboard should focus on.

### Citizen reports *(S3)*
| | Method & path | Auth | Notes |
|---|---|---|---|
| 🔜 S3 | `POST /reports` | any | `{ client_generated_id (uuid), hazard_type, lat, lon, description?, people_affected?, photo_url?, reported_at }`. Sending the same `client_generated_id` twice is safe — returns the original. |
| 🔜 S3 | `POST /reports/bulk` | any | `{ reports: [...] }` — flush the offline queue in one call |
| 🔜 S3 | `GET /reports/mine` | any | → `Report[]` |
| 🔜 S3 | Photo upload | any | Upload straight to Supabase Storage bucket `report-photos`, then send the public URL as `photo_url` |

**Offline:** generate `client_generated_id` with `crypto.randomUUID()` when the user taps submit, store the report in IndexedDB, and retry via `/reports/bulk` when back online. Duplicates are ignored server-side.

### Alerts *(S4)*
| | Method & path | Auth | Notes |
|---|---|---|---|
| 🔜 S4 | `POST /alerts/preview` | coordinator | `{ geofence: GeoJSON Polygon }` → `{ recipient_count }` — show live while drawing |
| 🔜 S4 | `POST /alerts` | coordinator | `{ incident_id?, tier, title, body, geofence, channels[] }` → `Alert` |
| 🔜 S4 | `GET /alerts` | coordinator | All alerts with delivery counts |
| 🔜 S4 | `GET /alerts/:id/deliveries` | coordinator | Per-recipient status |
| 🔜 S4 | `GET /alerts/inbox` | any | Alerts the current user received |
| 🔜 S4 | `POST /alerts/:id/acknowledge` | any | Marks the user's delivery as acknowledged |

### Admin *(S5)*
| | Method & path | Auth | Notes |
|---|---|---|---|
| 🔜 S5 | `POST /admin/simulate` | admin | `{ scenario: 'mumbai-flood' }` — runs a scripted demo |
| 🔜 S5 | `GET /admin/audit` | admin | Paginated audit log |
| 🔜 S5 | `GET /admin/sms-outbox` | coordinator, admin | Messages the mock SMS gateway "sent" |
| 🔜 S5 | `GET /admin/users` · `PATCH /admin/users/:id/role` | admin | User list and role changes |

## 5. Realtime

Subscribe directly via Supabase. Tables published: `incidents`, `reports`, `alerts`, `deliveries`. RLS applies, so each user only receives rows they're allowed to see.

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
npm run seed:users
npm run dev               # API on http://localhost:4000
```

Supabase Studio (database browser): http://127.0.0.1:54323
