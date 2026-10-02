export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:4000';
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
/** Optional: pre-fills the password when a demo account card is picked on the login screen. */
export const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? '';
