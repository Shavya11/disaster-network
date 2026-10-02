import type {
  AlertChannel,
  HazardType,
  IncidentStatus,
  SeverityTier,
  UserRole,
} from './enums.js';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  location: LatLon | null;
  location_updated_at: string | null;
  alert_radius_m: number;
  channels: AlertChannel[];
  telegram_chat_id: string | null;
  language: 'en' | 'hi';
  created_at: string;
}

export interface Incident {
  id: string;
  /** Short human-friendly reference for the control room, e.g. "INC-2043". */
  reference: string;
  /** e.g. "Kurla, Mumbai". Filled shortly after creation; null for a few seconds. */
  place_name: string | null;
  hazard_type: HazardType;
  title: string;
  description: string | null;
  status: IncidentStatus;
  severity_score: number;
  severity_tier: SeverityTier;
  epicenter: LatLon;
  /** GeoJSON Polygon, if an affected area has been drawn or computed. */
  affected_area: GeoJSONPolygon | null;
  report_count: number;
  signal_count: number;
  confidence: number;
  /** Highest tier an alert about this incident may be broadcast at. Separate from urgency. */
  alert_permission: SeverityTier;
  /** How the score was produced — show this in the incident detail panel. */
  severity_breakdown: SeverityBreakdown | null;
  origin: 'feed' | 'citizen';
  verified_by: string | null;
  verified_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SeverityBreakdown {
  H: number;
  E: number;
  V: number;
  C: number;
  raw: number;
  score: number;
  computed_tier: SeverityTier;
  tier: SeverityTier;
  tier_overridden: boolean;
  weights: { hazard: number; exposure: number; vulnerability: number };
  hazard_basis: string;
  exposure: {
    density_per_km2: number;
    density_basis: string;
    users_in_area: number;
    from_density: number;
    from_users: number;
  };
  vulnerability_factors: { factor: string; value: number }[];
  confidence_inputs: { contributor: string; c: number }[];
  alert_permission: SeverityTier;
  permission_reason: string;
}

export interface Report {
  id: string;
  user_id: string;
  incident_id: string | null;
  hazard_type: HazardType;
  location: LatLon;
  description: string | null;
  photo_url: string | null;
  people_affected: number | null;
  client_generated_id: string;
  reported_at: string;
  received_at: string;
  /** Present on GET /reports/mine. */
  incident_status?: IncidentStatus | null;
}

/** A raw event from a public feed (USGS, Open-Meteo, GDACS). */
export interface Signal {
  id: number;
  source: string;
  source_event_id: string;
  hazard_type: HazardType;
  location: LatLon;
  magnitude: number | null;
  title: string | null;
  occurred_at: string;
  /** Source-specific extras, e.g. `url`, `depth_km`, `alert_level`, `city`. */
  payload: Record<string, unknown>;
  incident_id: string | null;
}

export interface FeedHealth {
  source: string;
  last_run_at: string | null;
  last_run_ok: boolean | null;
  last_error: string | null;
  last_success_at: string | null;
  runs_24h: number;
  success_rate_24h: number | null;
  new_signals_24h: number;
  total_signals: number;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface IncidentTimelineEvent {
  at: string;
  kind: 'created' | 'signal' | 'report' | 'status' | 'dispatch' | 'alert' | 'resource' | 'road';
  /** Ready-to-display sentence, e.g. "Verified by R. Iyer". */
  text: string;
  actor: string | null;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
