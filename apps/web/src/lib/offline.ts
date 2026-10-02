import type { HazardType } from '@dn/shared';
import { api } from './api';

/** A citizen report as sent to POST /reports; queued on the device while offline. */
export interface QueuedReport {
  client_generated_id: string;
  hazard_type: HazardType;
  lat: number;
  lon: number;
  description?: string;
  people_affected?: number;
  photo_url?: string;
  reported_at: string;
}

const KEY = 'rk-report-queue';

export function readQueue(): QueuedReport[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedReport[];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedReport[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable — the report stays in memory only */
  }
}

export function enqueue(r: QueuedReport) {
  writeQueue([...readQueue(), r]);
}

/**
 * Send everything queued via /reports/bulk. Created and duplicate entries leave the queue;
 * ones the server refused are dropped too and returned so the user can be told.
 */
export async function flushQueue(): Promise<{ sent: number; failed: string[] }> {
  const q = readQueue();
  if (!q.length || !navigator.onLine) return { sent: 0, failed: [] };
  const { results } = await api.post<{ results: { client_generated_id: string; status: string; error?: string }[] }>('/reports/bulk', { reports: q.slice(0, 50) });
  const done = new Set(results.map((r) => r.client_generated_id));
  writeQueue(readQueue().filter((r) => !done.has(r.client_generated_id)));
  return {
    sent: results.filter((r) => r.status !== 'error').length,
    failed: results.filter((r) => r.status === 'error').map((r) => r.error ?? 'rejected'),
  };
}
