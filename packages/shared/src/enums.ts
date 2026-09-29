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

export const ALERT_CHANNELS = ['TELEGRAM', 'EMAIL', 'SMS', 'PUSH'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'ACKNOWLEDGED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
