import postgres from 'postgres';
import { env } from '../config/env.js';

// prepare:false is required for Supabase's transaction pooler (port 6543).
export const sql = postgres(env.DATABASE_URL, {
  max: 5,
  prepare: false,
  idle_timeout: 20,
});
