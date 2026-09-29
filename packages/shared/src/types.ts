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
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
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

export interface ApiError {
  error: string;
  details?: unknown;
}
