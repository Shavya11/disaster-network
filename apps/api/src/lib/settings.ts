// Admin-editable configuration. Rows in public.settings override the code defaults;
// values are applied in place to the config objects the engines already read.
import { HAZARD_TYPES } from '@dn/shared';
import { z } from 'zod';
import { WEATHER_THRESHOLDS } from '../ingestion/config.js';
import { ALERT_POLICY, CORRELATION, INCIDENT_RULES, WEIGHTS } from '../intelligence/config.js';
import { sql } from './db.js';

const correlationEntry = z.object({
  radiusKm: z.number().min(0.1).max(500),
  windowHours: z.number().min(1).max(240),
});

export const SETTINGS = {
  weather_thresholds: {
    target: WEATHER_THRESHOLDS,
    schema: z.object({
      heavyRainMm: z.number().min(1).max(500),
      galeGustKmh: z.number().min(10).max(300),
      heatwaveMaxC: z.number().min(25).max(55),
    }),
    description: 'When an Open-Meteo forecast becomes a signal (IMD defaults)',
  },
  severity_weights: {
    target: WEIGHTS,
    schema: z
      .object({
        hazard: z.number().min(0).max(1),
        exposure: z.number().min(0).max(1),
        vulnerability: z.number().min(0).max(1),
      })
      .refine((w) => Math.abs(w.hazard + w.exposure + w.vulnerability - 1) < 0.001, {
        message: 'weights must add up to 1',
      }),
    description: 'wH, wE, wV in the severity formula (Severity-Model §2)',
  },
  alert_policy: {
    target: ALERT_POLICY,
    schema: z.object({ watchConfidence: z.number().min(0.3).max(0.99) }),
    description: 'Confidence at which citizen-only evidence may trigger a WATCH alert',
  },
  incident_rules: {
    target: INCIDENT_RULES,
    schema: z.object({ earthquakeMinMagnitude: z.number().min(2.5).max(8) }),
    description: 'Smallest earthquake that opens an incident (smaller ones stay on the map only)',
  },
  correlation: {
    target: CORRELATION,
    schema: z.object(Object.fromEntries(HAZARD_TYPES.map((h) => [h, correlationEntry])) as Record<
      (typeof HAZARD_TYPES)[number],
      typeof correlationEntry
    >),
    description: 'Radius and time window used to group evidence into one incident, per hazard',
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

const DEFAULTS = Object.fromEntries(
  Object.entries(SETTINGS).map(([k, s]) => [k, structuredClone(s.target)]),
) as Record<SettingKey, unknown>;

export const defaultFor = (key: SettingKey) => structuredClone(DEFAULTS[key]);

function apply(key: SettingKey, value: unknown) {
  const target = SETTINGS[key].target as Record<string, unknown>;
  const fresh = defaultFor(key) as Record<string, unknown>;
  // Nested objects (correlation) are replaced per entry so partial overrides can't leave stale values.
  for (const k of Object.keys(fresh)) target[k] = fresh[k];
  Object.assign(target, value as object);
}

/** Load overrides from the database into the live config objects. */
export async function refreshSettings(): Promise<void> {
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from public.settings`;
  const overrides = new Map(rows.map((r) => [r.key, r.value]));
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const raw = overrides.get(key);
    const parsed = raw === undefined ? null : SETTINGS[key].schema.safeParse(raw);
    if (parsed && !parsed.success) console.warn(`Ignoring invalid stored setting "${key}"`);
    apply(key, parsed?.success ? parsed.data : defaultFor(key));
  }
}
