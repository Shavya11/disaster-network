# System Design

Backend design for the Intelligent Disaster Monitoring and Emergency Communication Network.
All diagrams are Mermaid and render on GitHub. Measured results are in [METRICS.md](METRICS.md);
the endpoint reference is [API-CONTRACT.md](API-CONTRACT.md).

## 1. Architecture

```mermaid
flowchart LR
    subgraph Clients
        PWA["React PWA<br/>citizen · responder · control room"]
    end

    subgraph GH["GitHub Actions (free)"]
        CRON["Scheduled ingestion<br/>every 10 min"]
        CI["CI: typecheck · tests · build"]
    end

    subgraph API["Node.js + TypeScript API (Render free)"]
        ROUTES["REST routes<br/>zod validation · role checks"]
        INT["Intelligence<br/>correlation · severity"]
        ROUTE["Routing<br/>closure-aware"]
        ALERT["Alert engine<br/>geofence · permission · dedup"]
    end

    subgraph SB["Supabase (free)"]
        PG[("PostgreSQL + PostGIS<br/>RLS · audit log")]
        AUTH["Auth (JWT)"]
        RT["Realtime"]
        ST["Storage<br/>report photos"]
    end

    subgraph EXT["Free public services"]
        FEEDS["USGS · Open-Meteo · GDACS<br/>NASA FIRMS (optional)"]
        OSRM["OSRM routing"]
        OSM["OpenStreetMap<br/>(shelters, one-off import)"]
    end

    PWA -- "login / signup" --> AUTH
    PWA -- "REST + Bearer JWT" --> ROUTES
    PWA -- "photo upload" --> ST
    RT -- "change events" --> PWA
    ROUTES --> INT & ROUTE & ALERT
    ROUTES & INT & ALERT <--> PG
    ROUTES -- "verify JWT" --> AUTH
    CRON -- "npm run ingest" --> FEEDS
    CRON --> INT
    ROUTE --> OSRM
    PG -. WAL .-> RT
```

**Key decisions**

| Decision | Reason |
|---|---|
| PostGIS for all location logic | Geofence, correlation, nearest-shelter and closure checks are single indexed SQL queries (M1: 1.8 ms for 100 k users). |
| Browser never writes to the database | All writes go through the API, which validates, checks roles and writes the audit log. RLS still guards every table as a second layer. |
| Ingestion runs in GitHub Actions, not on the API host | The free API host sleeps when idle; a scheduled job is reliable and costs nothing. |
| Rule-based severity, no ML | No labelled training data exists; every score must be explainable (Severity-Model.pdf §6). |
| Correlation serialised with an advisory lock | Concurrent report submissions and ingestion runs can't create duplicate incidents. |
| Urgency and alert permission stored separately | A high score never authorises a public alert by itself (report §9 C3). |

**Code layout** (`apps/api/src`)

| Folder | Contents |
|---|---|
| `ingestion/` | One adapter per feed (`FeedAdapter` interface), runner with idempotent upsert. New source = new adapter (FR-22). |
| `intelligence/` | `correlate.ts` (grouping, recompute), `severity.ts` (pure scoring functions + tests), `config.ts` (defaults). |
| `routing/` | OSRM client with closure checks and detours. |
| `simulator/` | Demo scenarios and cleanup. |
| `routes/` | One Express router per resource. |
| `lib/` | DB pool, audit writer, settings loader, geo SQL helpers. |

## 2. Data model

```mermaid
erDiagram
    PROFILES ||--o{ REPORTS : submits
    PROFILES ||--o{ SAFE_CHECKINS : "checks in"
    PROFILES ||--o{ DELIVERIES : receives
    PROFILES }o--o| TEAMS : "member of"
    PROFILES ||--o{ AUDIT_LOG : "acts in"
    INCIDENTS ||--o{ RAW_SIGNALS : "evidence"
    INCIDENTS ||--o{ REPORTS : "evidence"
    INCIDENTS ||--o{ ALERTS : "announced by"
    INCIDENTS ||--o{ ASSIGNMENTS : "handled by"
    INCIDENTS ||--o{ RESOURCE_ALLOCATIONS : "uses"
    INCIDENTS ||--o{ SAFE_CHECKINS : "relates to"
    INCIDENTS ||--o{ BLOCKED_ROADS : "causes"
    ALERTS ||--o{ DELIVERIES : "sent as"
    TEAMS ||--o{ ASSIGNMENTS : "works"
    RESOURCES ||--o{ RESOURCE_ALLOCATIONS : "allocated as"

    PROFILES {
        uuid id PK "= auth.users.id"
        user_role role "CITIZEN RESPONDER COORDINATOR ADMIN"
        geography last_location "only latest kept"
        int alert_radius_m
        uuid team_id FK
    }
    INCIDENTS {
        uuid id PK
        hazard_type hazard_type
        incident_status status
        numeric severity_score "0-100"
        severity_tier severity_tier "urgency"
        severity_tier alert_permission "max broadcast tier"
        jsonb severity_breakdown "H E V C and reasons"
        geography epicenter
        geography affected_area
        numeric confidence "noisy-OR"
    }
    RAW_SIGNALS {
        bigint id PK
        text source "usgs gdacs open-meteo firms simulator"
        text source_event_id "UNIQUE with source"
        geography location
        numeric magnitude
        jsonb payload
    }
    REPORTS {
        uuid id PK
        uuid client_generated_id "UNIQUE, offline idempotency"
        geography location
        text photo_url
    }
    ALERTS {
        uuid id PK
        severity_tier tier
        geography geofence
        int recipient_count
        int skipped_duplicates
    }
    DELIVERIES {
        bigint id PK
        alert_channel channel "IN_APP now"
        delivery_status status
        timestamptz acknowledged_at
    }
    TEAMS {
        uuid id PK
        team_type type
        team_status status
        geography current_location
    }
    ASSIGNMENTS {
        uuid id PK
        assignment_status status
        timestamptz sla_deadline
    }
    RESOURCES {
        uuid id PK
        int quantity
        int available
    }
    RESOURCE_ALLOCATIONS {
        uuid id PK
        int quantity
        timestamptz released_at
    }
    SHELTERS {
        uuid id PK
        int capacity
        int current_occupancy
        shelter_status status
    }
    SAFE_CHECKINS {
        uuid id PK
        checkin_status status
    }
    BLOCKED_ROADS {
        uuid id PK
        geography segment "LineString"
        bool active
    }
    AUDIT_LOG {
        bigint id PK
        text action
        jsonb before
        jsonb after
    }
```

Also: `feed_runs` (ingestion health), `settings` (admin overrides), `sms_outbox` (reserved for the SMS channel).
Every location column has a GiST index. `audit_log` rejects `UPDATE`, `DELETE` and `TRUNCATE` via triggers, for every role.

## 3. Main flows

### 3.1 Feed signal → incident

```mermaid
sequenceDiagram
    participant GA as GitHub Actions (cron)
    participant F as Public feed
    participant I as Ingestion runner
    participant C as Correlator
    participant DB as PostgreSQL
    participant RT as Realtime → dashboard

    GA->>I: npm run ingest (every 10 min)
    I->>F: fetch (USGS / Open-Meteo / GDACS)
    F-->>I: events
    I->>DB: upsert raw_signals ON CONFLICT (source, source_event_id)
    I->>DB: feed_runs row (ok, counts, error)
    GA->>C: correlateSignals()
    C->>DB: advisory lock
    loop each new signal inside India
        C->>DB: open incident, same hazard, within radius and time window?
        alt found
            C->>DB: link signal
        else intensity high enough
            C->>DB: create incident, link signal
        end
    end
    C->>DB: recompute epicenter, area, severity, alert_permission
    DB-->>RT: incident changed
```

### 3.2 Citizen report (online or offline)

```mermaid
sequenceDiagram
    participant P as PWA
    participant Q as IndexedDB queue
    participant A as API
    participant C as Correlator
    participant DB as PostgreSQL

    P->>Q: save report with client_generated_id
    alt online
        P->>A: POST /reports
    else offline, later
        P->>A: POST /reports/bulk (whole queue)
    end
    A->>A: validate (time window, own photo URL, rate limit on new reports only)
    A->>DB: INSERT … ON CONFLICT (client_generated_id) DO NOTHING
    alt new
        A->>C: correlateReport (under lock)
        C->>DB: join nearby open incident or create one, rescore
        A-->>P: 201 + incident_id
    else already received
        A-->>P: 200 (duplicate)
    end
    P->>Q: remove created / duplicate entries
```

### 3.3 Verify → dispatch → alert

```mermaid
sequenceDiagram
    participant CO as Coordinator
    participant A as API
    participant DB as PostgreSQL
    participant R as Responder app
    participant CI as Citizens in area

    CO->>A: POST /incidents/:id/verify
    A->>DB: status VERIFIED, C = 1, alert_permission = EMERGENCY, audit
    CO->>A: GET /teams?near_incident=:id
    CO->>A: POST /assignments (team, SLA)
    A->>DB: assignment, team ASSIGNED, incident ACTIVE, audit
    DB-->>R: realtime: new assignment
    R->>A: PATCH status ACKNOWLEDGED → EN_ROUTE → ON_SCENE
    R->>A: GET /routing/path (avoids closures)
    CO->>A: POST /alerts/preview (drawn polygon)
    A-->>CO: recipient_count, max_tier
    CO->>A: POST /alerts (tier ≤ alert_permission)
    A->>DB: ST_Covers(geofence, last_location) → deliveries (dedup 60 min), audit
    DB-->>CI: realtime: new delivery → inbox banner
    CI->>A: POST /alerts/:id/acknowledge · POST /checkins
```

## 4. State machines

### Incident

```mermaid
stateDiagram-v2
    [*] --> REPORTED: first signal or report
    REPORTED --> VERIFIED: coordinator verifies
    REPORTED --> REJECTED: coordinator rejects
    VERIFIED --> ACTIVE: team dispatched / manual
    VERIFIED --> CONTAINED
    VERIFIED --> RESOLVED
    VERIFIED --> REJECTED
    ACTIVE --> CONTAINED
    ACTIVE --> RESOLVED
    ACTIVE --> REJECTED
    CONTAINED --> ACTIVE: flare-up
    CONTAINED --> RESOLVED
    RESOLVED --> ACTIVE: reopen
    REJECTED --> REPORTED: undo
```

Only REPORTED, VERIFIED and ACTIVE incidents absorb new evidence.

### Assignment

```mermaid
stateDiagram-v2
    [*] --> ASSIGNED
    ASSIGNED --> ACKNOWLEDGED
    ACKNOWLEDGED --> EN_ROUTE
    EN_ROUTE --> ON_SCENE
    ON_SCENE --> COMPLETED
    ASSIGNED --> CANCELLED: coordinator only
    ACKNOWLEDGED --> CANCELLED: coordinator only
    EN_ROUTE --> CANCELLED: coordinator only
    ON_SCENE --> CANCELLED: coordinator only
    COMPLETED --> [*]
    CANCELLED --> [*]
```

A team holds at most one open assignment (partial unique index).

### Alert permission

| Evidence | `alert_permission` |
|---|---|
| Coordinator verified | EMERGENCY |
| Official source with hazard intensity H ≥ 0.35 (e.g. ≥ 64.5 mm rain, ≥ M5 shallow quake, GDACS Orange) | WARNING |
| Confidence ≥ 0.6 (≈ 3 independent citizen reports) | WATCH |
| Otherwise | INFO (no alerts) |
| Alert without a linked incident | WATCH at most |

## 5. Role permissions

| Capability | Public | Citizen | Responder | Coordinator | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| View incident map, signals, shelters, closures | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit reports, check-ins; read own alerts | | ✓ | ✓ | ✓ | ✓ |
| See citizen reports on an incident, resources | | | ✓ | ✓ | ✓ |
| Update own team's assignments and position; shelter occupancy | | | ✓ | ✓ | ✓ |
| Verify / reject / change incidents | | | | ✓ | ✓ |
| Dispatch teams, allocate resources, close roads | | | | ✓ | ✓ |
| Issue alerts | | | | ✓ | ✓ |
| Feed health, analytics, view settings, list users | | | | ✓ | ✓ |
| Change roles, change settings, audit log, poll feeds, simulator | | | | | ✓ |

Enforced twice: `requireRole` in the API, and row-level security for any direct database access from the browser.

## 6. Security and privacy

- Supabase Auth JWT on every non-public route; the role is read from the database on each request, never trusted from the token.
- Every request body and query is validated with zod schemas shared with the frontend.
- Users cannot change their own role or location through direct database access (column-level grants).
- Photos can be uploaded only into the user's own storage folder, and the API accepts only those URLs.
- Only the latest location is stored (NFR-8); deleting an account cascades to profile, reports and check-ins.
- Reports are rate-limited (60 new per hour); re-sent duplicates don't count.
- Every privileged action writes an append-only audit entry.
- Geofences are validated and capped at 25,000 km².

## 7. Cost

| Service | Plan | Used for |
|---|---|---|
| Supabase | Free | Database, auth, storage, realtime |
| Render | Free | API (sleeps when idle) |
| GitHub Actions | Free (unlimited for public repos) | CI, scheduled ingestion |
| USGS, Open-Meteo, GDACS, OSRM, OpenStreetMap | Free, no key | Data and routing |
| NASA FIRMS | Free key | Optional fire feed |

Total recurring cost: **₹0** (NFR-14).
