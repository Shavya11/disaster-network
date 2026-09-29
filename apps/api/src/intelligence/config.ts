import type { HazardType } from '@dn/shared';

// All values here are meant to become admin-editable in V2 (S9).

/** Deployment region. Feed signals outside it stay on the map but never become incidents. */
export const REGION = { name: 'India', minLon: 68, minLat: 6, maxLon: 98, maxLat: 37 };

/** Spatio-temporal correlation window per hazard (report §9 C4). */
export const CORRELATION: Record<HazardType, { radiusKm: number; windowHours: number }> = {
  EARTHQUAKE: { radiusKm: 100, windowHours: 24 },
  CYCLONE: { radiusKm: 300, windowHours: 96 },
  FLOOD: { radiusKm: 25, windowHours: 48 },
  STORM: { radiusKm: 50, windowHours: 24 },
  HEATWAVE: { radiusKm: 50, windowHours: 72 },
  WILDFIRE: { radiusKm: 10, windowHours: 48 },
  LANDSLIDE: { radiusKm: 5, windowHours: 48 },
  BUILDING_COLLAPSE: { radiusKm: 0.5, windowHours: 12 },
  GAS_LEAK: { radiusKm: 1, windowHours: 6 },
  MEDICAL: { radiusKm: 0.5, windowHours: 6 },
  FIRE: { radiusKm: 1, windowHours: 12 },
  ROAD_BLOCKAGE: { radiusKm: 0.5, windowHours: 12 },
  OTHER: { radiusKm: 1, windowHours: 12 },
};

/** Severity-Model §2 weights. */
export const WEIGHTS = { hazard: 0.55, exposure: 0.3, vulnerability: 0.15 };

/** Severity-Model §5 tier bands (lower bound, inclusive). */
export const TIER_BANDS = [
  { min: 75, tier: 'EMERGENCY' },
  { min: 50, tier: 'WARNING' },
  { min: 25, tier: 'WATCH' },
  { min: 0, tier: 'INFO' },
] as const;

/** Severity-Model §4.3 credibility per contributing signal. */
export const CREDIBILITY = {
  official: 0.95,
  satellite: 0.85,
  citizenTrusted: 0.55,
  citizenPhoto: 0.45,
  citizenText: 0.3,
};
export const OFFICIAL_SOURCES = ['usgs', 'gdacs', 'open-meteo', 'simulator'];
export const SATELLITE_SOURCES = ['firms'];

/** Minimum hazard intensity for a feed signal to open a new incident (below: map only). */
export const MIN_H_TO_OPEN: Record<string, number> = {
  default: 0.1,
  // Thousands of small agricultural fires per day in season; only ≥10 MW open incidents.
  firms: 0.35,
};

/** Confidence at which citizen-only evidence may trigger a WATCH alert (≈ 3 text reports). */
export const ALERT_POLICY = { watchConfidence: 0.6 };

/**
 * Citizen reports carry no measured intensity, so H comes from the reported
 * hazard type. Project assumption, not from a published source.
 */
export const REPORT_BASE_H: Record<HazardType, number> = {
  BUILDING_COLLAPSE: 0.6,
  GAS_LEAK: 0.5,
  FIRE: 0.5,
  LANDSLIDE: 0.5,
  FLOOD: 0.35,
  EARTHQUAKE: 0.35,
  CYCLONE: 0.4,
  STORM: 0.3,
  WILDFIRE: 0.4,
  HEATWAVE: 0.3,
  MEDICAL: 0.3,
  ROAD_BLOCKAGE: 0.2,
  OTHER: 0.2,
};

/** Approximate city-level population density (persons/km², Census 2011 order of magnitude). */
export const CITY_DENSITY: Record<string, number> = {
  mumbai: 20000, delhi: 11300, kolkata: 24000, chennai: 26500, bengaluru: 4400,
  hyderabad: 18400, ahmedabad: 11900, pune: 6000, surat: 13700, jaipur: 6500,
  lucknow: 7900, patna: 11000, bhopal: 4000, nagpur: 11000, bhubaneswar: 6000,
  visakhapatnam: 3000, guwahati: 5000, kochi: 7000, thiruvananthapuram: 5300,
  dehradun: 3700, shimla: 5000, srinagar: 4800,
};
export const CITY_RADIUS_KM = 25;
export const DEFAULT_DENSITY_IN_REGION = 460; // India national average
export const DEFAULT_DENSITY_OUTSIDE = 60; // world land average
/** Registered users in the area at which user-based exposure saturates. */
export const USER_EXPOSURE_SATURATION = 1000;
