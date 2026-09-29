# Evaluation Metrics

Measured 2026-09-29 11:15 UTC on the local development stack
(Node v24.15.0, PostgreSQL 17 + PostGIS via Supabase CLI in Docker). Re-generate with `npm run metrics`.

Metric numbering follows report §17. M2/M3 (alert delivery to devices) wait for the external
channels; M7 (7-day ingestion reliability) is read from `GET /admin/analytics` → `feeds` once the
scheduled job has been running in the cloud; M9/M10 are measured on the frontend.

## M1 — Geofence resolution, 100,000 users

Target: < 500 ms. Method: 100,000 random points over Greater Mumbai; count points inside a ~3 × 3 km polygon with `ST_Covers` (the same predicate the alert engine uses), median of 5 warm runs from `EXPLAIN ANALYZE`.

| | Execution time | Users matched |
|---|---:|---:|
| Without GiST index | 24.74 ms | 638 |
| With GiST index | 0.85 ms | 638 |
| **Speed-up** | **29.25×** | |

Result: **PASS**

## M4 — Real-time dashboard latency

Target: < 2 s. Method: a browser-equivalent Supabase client subscribed (with the public key, through RLS) to one incident; 20 committed updates; time from commit to event received.

| Events received | Median | p95 | Max |
|---:|---:|---:|---:|
| 20/20 | 524.03 ms | 530.87 ms | 530.87 ms |

Result: **PASS**

## M5 — Offline synchronisation

Target: 100 % delivered, 0 duplicates. Method: 50 reports queued offline; the connection drops after 20 are delivered; the client then re-sends the full queue twice via `POST /reports/bulk`.

| Attempt | HTTP | Created | Duplicate (ignored) | Errors |
|---|---:|---:|---:|---:|
| First 20 | 200 | 20 | 0 | 0 |
| Full queue, retry 1 | 200 | 30 | 20 | 0 |
| Full queue, retry 2 | 200 | 0 | 50 | 0 |

Rows stored: **50** (distinct ids 50) of 50.

Result: **PASS**

## M6 — Correlation accuracy

Target: ≥ 90 % correctly grouped. Method: 200 synthetic citizen reports from 6 known events, shuffled and submitted one by one. Two of the events are the same hazard type only 2 km apart and must stay separate. A report counts as correct when it lands in the incident that holds the majority of its event's reports.

| Event | Reports | Incidents used | In majority incident |
|---|---:|---:|---:|
| Flood, Kurla (Mumbai) | 34 | 1 | 34 |
| Flood, Yamuna bank (Delhi) | 34 | 1 | 34 |
| Building collapse, Dharavi | 33 | 1 | 33 |
| Building collapse, 2 km north | 33 | 1 | 33 |
| Fire, Andheri | 33 | 1 | 33 |
| Gas leak, Thane | 33 | 1 | 33 |

Distinct events wrongly merged into one incident: **0**. Accuracy: **100 %**.

Result: **PASS**

## M8 — Concurrent load

Target: stable p95 latency under load. Method: [autocannon](https://github.com/mcollina/autocannon), 100 concurrent connections for 10 s per endpoint, against a separate API process on the development machine with the local database. Free-tier cloud hosting will be slower; re-run against the deployed URL for the final figure.

| Endpoint | Requests | Req/s | p50 | p97.5 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|
| `GET /incidents` | 3092 | 309.2 | 318 ms | 367 ms | 374 ms | 0 |
| `GET /signals?limit=200` | 4194 | 419.4 | 230 ms | 283 ms | 440 ms | 0 |
| `GET /shelters/nearby?lat=19.07&lon=72.88&radius_km=5` | 15803 | 1580.3 | 61 ms | 75 ms | 84 ms | 0 |

Result: **PASS** (no errors, p99 < 2 s)
