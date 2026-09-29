// Keep these in sync with the Postgres enums in supabase/migrations.

export const USER_ROLES = ['CITIZEN', 'RESPONDER', 'COORDINATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STAFF_ROLES: readonly UserRole[] = ['COORDINATOR', 'ADMIN'];

export const HAZARD_TYPES = [
  'EARTHQUAKE',
  'FLOOD',
  'CYCLONE',
  'STORM',
  'WILDFIRE',
  'HEATWAVE',
  'LANDSLIDE',
  'BUILDING_COLLAPSE',
  'GAS_LEAK',
  'MEDICAL',
  'FIRE',
  'ROAD_BLOCKAGE',
  'OTHER',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export const INCIDENT_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'ACTIVE',
  'CONTAINED',
  'RESOLVED',
  'REJECTED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const SEVERITY_TIERS = ['INFO', 'WATCH', 'WARNING', 'EMERGENCY'] as const;
export type SeverityTier = (typeof SEVERITY_TIERS)[number];

/** Only IN_APP is delivered today; the others are placeholders for external integrations. */
export const ALERT_CHANNELS = ['IN_APP', 'TELEGRAM', 'EMAIL', 'SMS', 'PUSH'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const TEAM_TYPES = ['FIRE', 'MEDICAL', 'POLICE', 'SEARCH_RESCUE', 'NDRF', 'VOLUNTEER'] as const;
export type TeamType = (typeof TEAM_TYPES)[number];

export const TEAM_STATUSES = ['AVAILABLE', 'ASSIGNED', 'OFF_DUTY'] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'ASSIGNED',
  'ACKNOWLEDGED',
  'EN_ROUTE',
  'ON_SCENE',
  'COMPLETED',
  'CANCELLED',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SHELTER_STATUSES = ['OPEN', 'FULL', 'CLOSED'] as const;
export type ShelterStatus = (typeof SHELTER_STATUSES)[number];

export const CHECKIN_STATUSES = ['SAFE', 'NEED_HELP'] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'ACKNOWLEDGED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
