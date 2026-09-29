import { z } from 'zod';
import { ALERT_CHANNELS, HAZARD_TYPES, INCIDENT_STATUSES, SEVERITY_TIERS } from './enums.js';

export const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const updateLocationSchema = latLonSchema;

export const updateProfileSchema = z
  .object({
    full_name: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(20),
    alert_radius_m: z.number().int().min(500).max(200_000),
    channels: z.array(z.enum(ALERT_CHANNELS)).max(ALERT_CHANNELS.length),
    telegram_chat_id: z.string().trim().max(40).nullable(),
    language: z.enum(['en', 'hi']),
  })
  .partial();

const csvNumbers = (count: number) =>
  z
    .string()
    .transform((s) => s.split(',').map(Number))
    .refine((a) => a.length === count && a.every(Number.isFinite), {
      message: `expected ${count} comma-separated numbers`,
    });

export const listIncidentsQuerySchema = z.object({
  // minLon,minLat,maxLon,maxLat
  bbox: csvNumbers(4).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  hazard: z.enum(HAZARD_TYPES).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const listSignalsQuerySchema = z.object({
  bbox: csvNumbers(4).optional(),
  source: z.string().max(40).optional(),
  hazard: z.enum(HAZARD_TYPES).optional(),
  // Defaults to the last 3 days.
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const createReportSchema = z.object({
  client_generated_id: z.string().uuid(),
  hazard_type: z.enum(HAZARD_TYPES),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  description: z.string().trim().max(1000).optional(),
  people_affected: z.number().int().min(0).max(100_000).optional(),
  photo_url: z.string().url().max(500).optional(),
  reported_at: z.string().datetime({ offset: true }),
});

export const bulkReportsSchema = z.object({
  reports: z.array(createReportSchema).min(1).max(50),
});

export const verifyIncidentSchema = z.object({
  /** Optional manual tier; otherwise the computed tier is kept. */
  tier: z.enum(SEVERITY_TIERS).optional(),
  note: z.string().trim().max(500).optional(),
});

export const rejectIncidentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const updateIncidentStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'CONTAINED', 'RESOLVED', 'REPORTED'] as const),
  note: z.string().trim().max(500).optional(),
});

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).nullable(),
    tier: z.enum(SEVERITY_TIERS).nullable(),
  })
  .partial();

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type ListSignalsQuery = z.infer<typeof listSignalsQuerySchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
