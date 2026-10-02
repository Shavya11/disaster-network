import { API_URL } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) await supabase.auth.signOut();
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`, json?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const fe = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
    const first = fe && Object.entries(fe)[0];
    return first ? `${err.message}: ${first[0]} — ${first[1][0]}` : err.message;
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';
  return err instanceof Error ? err.message : 'Something went wrong';
}
