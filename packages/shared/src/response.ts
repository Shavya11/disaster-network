// Schemas and types for teams, assignments, resources, shelters, check-ins, roads, admin.
import { z } from 'zod';
import {
  ASSIGNMENT_STATUSES,
  CHECKIN_STATUSES,
  HAZARD_TYPES,
  SEVERITY_TIERS,
  SHELTER_STATUSES,
  TEAM_STATUSES,
  TEAM_TYPES,
  USER_ROLES,
  type AssignmentStatus,
  type CheckinStatus,
  type HazardType,
  type IncidentStatus,
  type SeverityTier,
  type ShelterStatus,
  type TeamStatus,
  type TeamType,
  type UserRole,
} from './enums.js';
import type { LatLon } from './types.js';

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const point = z.object({ lat, lon });

// ---------------------------------------------------------------- teams
export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(TEAM_TYPES),
  base: point,
  member_count: z.number().int().min(0).max(500).default(0),
});
export const updateTeamSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    status: z.enum(TEAM_STATUSES),
    member_count: z.number().int().min(0).max(500),
  })
  .partial();
export const teamLocationSchema = point;
export const teamMemberSchema = z.object({ user_id: z.string().uuid() });

export interface Team {
  id: string;
  name: string;
  type: TeamType;
  status: TeamStatus;
  base_location: LatLon;
  current_location: LatLon | null;
  location_updated_at: string | null;
  member_count: number;
  /** Open assignment, if any. */
  active_assignment_id: string | null;
  /** Present when listing teams for an incident: straight-line km to the incident. */
  distance_km?: number;
}

// ---------------------------------------------------------------- assignments
export const createAssignmentSchema = z.object({
  incident_id: z.string().uuid(),
  team_id: z.string().uuid(),
  instructions: z.string().trim().max(1000).optional(),
  /** Minutes until the team must be on scene. Default depends on severity tier. */
  sla_minutes: z.number().int().min(5).max(24 * 60).optional(),
});
export const updateAssignmentStatusSchema = z.object({
  status: z.enum(ASSIGNMENT_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export interface Assignment {
  id: string;
  incident_id: string;
  team_id: string;
  team_name: string;
  incident_title: string;
  incident_hazard: HazardType;
  incident_tier: SeverityTier;
  incident_location: LatLon;
  assigned_by: string | null;
  status: AssignmentStatus;
  instructions: string | null;
  sla_deadline: string;
  sla_breached: boolean;
  created_at: string;
  acknowledged_at: string | null;
  en_route_at: string | null;
  on_scene_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------- resources
export const createResourceSchema = z.object({
  type: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(100),
  unit: z.string().trim().max(20).default('units'),
  quantity: z.number().int().min(0).max(1_000_000),
  depot_name: z.string().trim().min(2).max(100),
  location: point,
});
export const updateResourceSchema = z.object({
  quantity: z.number().int().min(0).max(1_000_000),
});
export const allocateResourceSchema = z.object({
  resource_id: z.string().uuid(),
  incident_id: z.string().uuid(),
  quantity: z.number().int().min(1),
});

export interface Resource {
  id: string;
  type: string;
  name: string;
  unit: string;
  quantity: number;
  available: number;
  depot_name: string;
  location: LatLon;
  distance_km?: number;
}

export interface ResourceAllocation {
  id: string;
  resource_id: string;
  resource_name: string;
  unit: string;
  incident_id: string;
  quantity: number;
  allocated_by: string | null;
  allocated_at: string;
  released_at: string | null;
}

// ---------------------------------------------------------------- shelters
export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().min(0.1).max(200).default(10),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const createShelterSchema = z.object({
  name: z.string().trim().min(2).max(150),
  kind: z.enum(['shelter', 'hospital', 'school', 'community_centre']).default('shelter'),
  location: point,
  capacity: z.number().int().min(0).max(100_000),
  facilities: z.array(z.string().trim().max(40)).max(20).default([]),
  contact_phone: z.string().trim().max(20).optional(),
});
export const updateShelterSchema = z
  .object({
    capacity: z.number().int().min(0).max(100_000),
    current_occupancy: z.number().int().min(0).max(100_000),
    status: z.enum(SHELTER_STATUSES),
    facilities: z.array(z.string().trim().max(40)).max(20),
    contact_phone: z.string().trim().max(20).nullable(),
  })
  .partial();

export interface Shelter {
  id: string;
  name: string;
  kind: string;
  location: LatLon;
  capacity: number;
  current_occupancy: number;
  /** capacity − occupancy, never negative. */
  spaces_left: number;
  facilities: string[];
  contact_phone: string | null;
  status: ShelterStatus;
  updated_at: string;
  distance_km?: number;
}

// ---------------------------------------------------------------- check-ins
export const createCheckinSchema = z.object({
  status: z.enum(CHECKIN_STATUSES),
  incident_id: z.string().uuid().optional(),
  lat: lat.optional(),
  lon: lon.optional(),
  note: z.string().trim().max(500).optional(),
});

export interface Checkin {
  id: string;
  user_id: string;
  user_name?: string | null;
  incident_id: string | null;
  status: CheckinStatus;
  location: LatLon | null;
  note: string | null;
  created_at: string;
}

export interface CheckinSummary {
  incident_id: string;
  safe: number;
  need_help: number;
  /** Latest check-in per user who needs help. */
  need_help_list: Checkin[];
}

// ---------------------------------------------------------------- roads & routing
export const blockRoadSchema = z.object({
  /** [lon, lat] pairs, GeoJSON order — e.g. from Leaflet polyline toGeoJSON(). */
  coordinates: z.array(z.tuple([lon, lat])).min(2).max(200),
  reason: z.string().trim().min(3).max(300),
  incident_id: z.string().uuid().optional(),
});
export const routeQuerySchema = z.object({
  from: z.string().transform((s, ctx) => parsePoint(s, ctx)),
  to: z.string().transform((s, ctx) => parsePoint(s, ctx)),
});

function parsePoint(s: string, ctx: z.RefinementCtx): LatLon {
  const [a, b] = s.split(',').map(Number);
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected "lat,lon"' });
    return { lat: 0, lon: 0 };
  }
  return { lat: a, lon: b };
}

export interface BlockedRoad {
  id: string;
  segment: { type: 'LineString'; coordinates: [number, number][] };
  reason: string;
  incident_id: string | null;
  marked_by: string | null;
  active: boolean;
  created_at: string;
  cleared_at: string | null;
}

export interface RouteResult {
  /** GeoJSON LineString of the chosen route. */
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null;
  distance_km: number | null;
  duration_min: number | null;
  /** True if no candidate route avoided every active closure. */
  blocked: boolean;
  /** Closures the returned route still passes through (only when blocked). */
  crosses_closures: string[];
  alternatives_checked: number;
  provider: string;
}

// ---------------------------------------------------------------- admin
export const listUsersQuerySchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const setRoleSchema = z.object({ role: z.enum(USER_ROLES) });
export const auditQuerySchema = z.object({
  entity_type: z.string().max(40).optional(),
  entity_id: z.string().max(80).optional(),
  actor_id: z.string().uuid().optional(),
  before_id: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const simulateSchema = z.object({
  scenario: z.enum(['mumbai-flood', 'delhi-earthquake', 'building-collapse']),
});

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  team_id: string | null;
  has_location: boolean;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  at: string;
}

export interface SimulationResult {
  scenario: string;
  signals_created: number;
  reports_created: number;
  incident_ids: string[];
}

// ---------------------------------------------------------------- alerts
const ring = z.array(z.tuple([lon, lat])).min(4).max(1000);
export const geofenceSchema = z
  .object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(10) })
  .refine((g) => g.coordinates.every((r) => r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1]), {
    message: 'polygon rings must be closed (first point = last point)',
  });

export const previewAlertSchema = z.object({ geofence: geofenceSchema });

export const createAlertSchema = z.object({
  incident_id: z.string().uuid().optional(),
  tier: z.enum(SEVERITY_TIERS),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  geofence: geofenceSchema,
});

export interface AlertPreview {
  recipient_count: number;
  area_km2: number;
  /** Highest tier allowed for the chosen incident (or for alerts without an incident). */
  max_tier: SeverityTier;
}

export interface Alert {
  id: string;
  incident_id: string | null;
  incident_title: string | null;
  tier: SeverityTier;
  title: string;
  body: string;
  geofence: { type: 'Polygon'; coordinates: [number, number][][] };
  channels: string[];
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  sent_at: string | null;
  recipient_count: number;
  skipped_duplicates: number;
  acknowledged_count: number;
}

export interface AlertDelivery {
  id: number;
  user_id: string;
  user_name: string | null;
  channel: string;
  status: string;
  sent_at: string | null;
  acknowledged_at: string | null;
}

export interface InboxAlert {
  alert_id: string;
  incident_id: string | null;
  tier: SeverityTier;
  title: string;
  body: string;
  geofence: { type: 'Polygon'; coordinates: [number, number][][] };
  received_at: string;
  acknowledged_at: string | null;
}

// ---------------------------------------------------------------- analytics
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export interface Analytics {
  window_days: number;
  incidents: {
    total: number;
    by_status: Record<IncidentStatus, number>;
    by_hazard: { hazard_type: HazardType; count: number }[];
    by_tier: Record<SeverityTier, number>;
    per_day: { day: string; count: number }[];
  };
  response: {
    /** Minutes from incident creation to coordinator verification. */
    median_time_to_verify_min: number | null;
    /** Minutes from assignment to team on scene. */
    median_time_to_scene_min: number | null;
    assignments_total: number;
    sla_met_pct: number | null;
  };
  reports: { total: number; with_photo: number; linked_to_verified_pct: number | null };
  feeds: { source: string; runs: number; success_pct: number | null; signals: number }[];
  checkins: { safe: number; need_help: number };
}
