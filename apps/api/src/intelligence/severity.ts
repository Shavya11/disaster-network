// Implements Severity-Model.pdf. Pure functions: no database access.
import type { HazardType, SeverityBreakdown, SeverityTier } from '@dn/shared';
import {
  CREDIBILITY,
  OFFICIAL_SOURCES,
  REPORT_BASE_H,
  TIER_BANDS,
  USER_EXPOSURE_SATURATION,
  WATCH_CONFIDENCE,
  WEIGHTS,
} from './config.js';

export type Contributor =
  | {
      kind: 'signal';
      id: string;
      source: string;
      hazard_type: HazardType;
      magnitude: number | null;
      occurred_at: Date;
      lon: number;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'report';
      id: string;
      hazard_type: HazardType;
      occurred_at: Date;
      lon: number;
      has_photo: boolean;
      reporter_trusted: boolean;
      people_affected: number | null;
    };

export interface ScoreInput {
  hazard_type: HazardType;
  contributors: Contributor[];
  verified: boolean;
  tier_override: SeverityTier | null;
  density_per_km2: number;
  density_basis: string;
  users_in_area: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

function bandLookup(value: number, bands: [number, number][]): number {
  let h = 0;
  for (const [min, score] of bands) if (value >= min) h = score;
  return h;
}

// §3.1 IMD rainfall
export const rainH = (mm: number) =>
  bandLookup(mm, [[15.6, 0.1], [64.5, 0.35], [115.6, 0.65], [204.5, 0.95]]);

// §3.2 IMD cyclone / wind
export const windH = (kmh: number) =>
  bandLookup(kmh, [[31, 0.15], [50, 0.25], [62, 0.4], [89, 0.6], [118, 0.8], [168, 0.92], [222, 1]]);

// §3.3 magnitude anchors (linear between) × depth factor
export function earthquakeH(mag: number, depthKm: number | null): number {
  const anchors: [number, number][] = [[4, 0.05], [5, 0.35], [6, 0.6], [7, 0.85], [8, 1]];
  let base: number;
  if (mag <= 4) base = 0.05;
  else if (mag >= 8) base = 1;
  else {
    const i = anchors.findIndex(([m]) => m > mag);
    const [m0, h0] = anchors[i - 1]!;
    const [m1, h1] = anchors[i]!;
    base = h0 + ((mag - m0) / (m1 - m0)) * (h1 - h0);
  }
  const depth = depthKm ?? 0;
  const factor = depth <= 70 ? 1 : depth <= 300 ? 0.55 : 0.3;
  return base * factor;
}

// §3.4 IMD heatwave, absolute criteria only (no long-period normals available).
// 40–45 °C is our assumption: above the plains threshold but departure unknown.
export const heatH = (c: number) => bandLookup(c, [[40, 0.35], [45, 0.55], [47, 0.85]]);

const GDACS_LEVEL_H: Record<string, number> = { Green: 0.3, Orange: 0.6, Red: 0.9 };

export function contributorH(c: Contributor): { h: number; basis: string } {
  if (c.kind === 'report') {
    const base = REPORT_BASE_H[c.hazard_type];
    const people = c.people_affected ?? 0;
    const boost = people >= 100 ? 0.2 : people >= 10 ? 0.1 : 0;
    return {
      h: clamp01(base + boost),
      basis: `citizen report (${c.hazard_type}${people ? `, ${people} people affected` : ''})`,
    };
  }

  const p = c.payload;
  const m = c.magnitude;
  if (c.hazard_type === 'EARTHQUAKE' && m != null) {
    const depth = typeof p.depth_km === 'number' ? p.depth_km : null;
    return { h: earthquakeH(m, depth), basis: `M ${m} at ${depth ?? '?'} km depth` };
  }
  if (c.hazard_type === 'FLOOD' && m != null && p.unit === 'mm') {
    return { h: rainH(m), basis: `${m} mm rain / 24 h (IMD)` };
  }
  if ((c.hazard_type === 'STORM' || c.hazard_type === 'CYCLONE') && m != null &&
      (p.unit === 'km/h' || p.severity_unit === 'km/h')) {
    return { h: windH(m), basis: `${m} km/h wind (IMD)` };
  }
  if (c.hazard_type === 'HEATWAVE' && m != null) {
    return { h: heatH(m), basis: `${m} °C max temperature (IMD)` };
  }
  if (typeof p.alert_level === 'string' && p.alert_level in GDACS_LEVEL_H) {
    return { h: GDACS_LEVEL_H[p.alert_level]!, basis: `GDACS ${p.alert_level} alert` };
  }
  return { h: 0.1, basis: `${c.source} signal, intensity unknown` };
}

function contributorCredibility(c: Contributor): number {
  if (c.kind === 'signal') return OFFICIAL_SOURCES.includes(c.source) ? CREDIBILITY.official : 0.5;
  if (c.reporter_trusted) return CREDIBILITY.citizenTrusted;
  return c.has_photo ? CREDIBILITY.citizenPhoto : CREDIBILITY.citizenText;
}

const isForecast = (c: Contributor) => c.kind === 'signal' && typeof c.payload.forecast_date === 'string';

function vulnerability(input: ScoreInput): { v: number; factors: { factor: string; value: number }[] } {
  const factors: { factor: string; value: number }[] = [];
  const cs = input.contributors;

  // Night-time at the event location: local solar time from longitude.
  const observed = cs.filter((c) => !isForecast(c)).sort((a, b) => +a.occurred_at - +b.occurred_at)[0];
  if (observed) {
    const hour = (observed.occurred_at.getUTCHours() + observed.occurred_at.getUTCMinutes() / 60 +
      observed.lon / 15 + 24) % 24;
    if (hour >= 22 || hour < 6) factors.push({ factor: 'night-time event (22:00–06:00 local)', value: 0.2 });
  }

  // Rising trend: a later forecast day is worse than the first one.
  const forecasts = cs
    .filter((c): c is Extract<Contributor, { kind: 'signal' }> => isForecast(c) && c.kind === 'signal')
    .sort((a, b) => String(a.payload.forecast_date).localeCompare(String(b.payload.forecast_date)));
  if (forecasts.length >= 2 && (forecasts.at(-1)!.magnitude ?? 0) > (forecasts[0]!.magnitude ?? 0)) {
    factors.push({ factor: 'rising trend in forecast', value: 0.25 });
  }

  // Compound event: repeated heavy-rain days, or a second earthquake within 24 h.
  const quakes = cs.filter((c) => c.kind === 'signal' && c.hazard_type === 'EARTHQUAKE');
  const quakeSpanH = quakes.length >= 2
    ? (Math.max(...quakes.map((q) => +q.occurred_at)) - Math.min(...quakes.map((q) => +q.occurred_at))) / 3.6e6
    : Infinity;
  const rainDays = new Set(forecasts.filter((f) => f.hazard_type === 'FLOOD').map((f) => f.payload.forecast_date));
  if (quakeSpanH <= 24) factors.push({ factor: 'second earthquake within 24 h', value: 0.2 });
  else if (rainDays.size >= 2) factors.push({ factor: 'consecutive heavy-rain days', value: 0.2 });

  // Monsoon season (June–September) for water/wind hazards.
  const first = [...cs].sort((a, b) => +a.occurred_at - +b.occurred_at)[0];
  const month = (first ? new Date(+first.occurred_at + 5.5 * 3.6e6) : new Date()).getUTCMonth() + 1;
  if (month >= 6 && month <= 9 && ['FLOOD', 'CYCLONE', 'STORM', 'LANDSLIDE'].includes(input.hazard_type)) {
    factors.push({ factor: 'monsoon season', value: 0.1 });
  }

  return { v: clamp01(factors.reduce((s, f) => s + f.value, 0)), factors };
}

export function tierForScore(score: number): SeverityTier {
  return TIER_BANDS.find((b) => score >= b.min)!.tier;
}

export function scoreIncident(input: ScoreInput): SeverityBreakdown {
  const hazards = input.contributors.map((c) => ({ ...contributorH(c), c }));
  const top = hazards.reduce((a, b) => (b.h > a.h ? b : a), { h: 0, basis: 'no evidence', c: null as never });
  const H = top.h;

  const eDensity = clamp01(Math.log10(1 + input.density_per_km2) / Math.log10(1 + 20000));
  const eUsers = clamp01(Math.log10(1 + input.users_in_area) / Math.log10(1 + USER_EXPOSURE_SATURATION));
  const E = Math.max(eDensity, eUsers);

  const { v: V, factors } = vulnerability(input);

  const credibilities = input.contributors.map((c) => ({
    contributor: `${c.kind}:${c.kind === 'signal' ? c.source : 'citizen'}:${c.id}`,
    c: contributorCredibility(c),
  }));
  const C = input.verified ? 1 : 1 - credibilities.reduce((p, x) => p * (1 - x.c), 1);

  const raw = 100 * (WEIGHTS.hazard * H + WEIGHTS.exposure * E + WEIGHTS.vulnerability * V);
  const score = Math.round(raw * C * 100) / 100;
  const computedTier = tierForScore(score);

  // Permission to broadcast is separate from urgency (Severity-Model §5, report §9 C3).
  const officialAboveThreshold = hazards.some(
    (x) => x.c.kind === 'signal' && OFFICIAL_SOURCES.includes(x.c.source) && x.h >= 0.35,
  );
  const [alert_permission, permission_reason]: [SeverityTier, string] = input.verified
    ? ['EMERGENCY', 'verified by coordinator']
    : officialAboveThreshold
      ? ['WARNING', 'official source above threshold']
      : C >= WATCH_CONFIDENCE
        ? ['WATCH', `corroborated (confidence ${round(C, 2)} ≥ ${WATCH_CONFIDENCE})`]
        : ['INFO', 'unverified and not corroborated'];

  return {
    H: round(H),
    E: round(E),
    V: round(V),
    C: round(C),
    raw: round(raw, 2),
    score,
    computed_tier: computedTier,
    tier: input.tier_override ?? computedTier,
    tier_overridden: input.tier_override != null,
    weights: WEIGHTS,
    hazard_basis: top.basis,
    exposure: {
      density_per_km2: input.density_per_km2,
      density_basis: input.density_basis,
      users_in_area: input.users_in_area,
      from_density: round(eDensity),
      from_users: round(eUsers),
    },
    vulnerability_factors: factors,
    confidence_inputs: input.verified ? [{ contributor: 'coordinator verification', c: 1 }] : credibilities,
    alert_permission,
    permission_reason,
  };
}
