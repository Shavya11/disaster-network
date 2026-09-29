// Creates one demo account per role. Safe to re-run.
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const { SUPABASE_URL, SUPABASE_SECRET_KEY, DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !DATABASE_URL) {
  throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL must be set');
}

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345';

const users = [
  { email: 'citizen@demo.dn', name: 'Demo Citizen', role: 'CITIZEN', lat: 19.076, lon: 72.8777 },
  { email: 'responder@demo.dn', name: 'Demo Responder', role: 'RESPONDER', lat: 19.1, lon: 72.9 },
  { email: 'coordinator@demo.dn', name: 'Demo Coordinator', role: 'COORDINATOR', lat: 19.05, lon: 72.85 },
  { email: 'admin@demo.dn', name: 'Demo Admin', role: 'ADMIN', lat: 19.02, lon: 72.84 },
] as const;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

for (const u of users) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.name },
  });

  let id = data.user?.id;
  if (error) {
    if (!/already been registered|already exists/i.test(error.message)) throw error;
    const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${u.email}`;
    id = existing?.id;
  }
  if (!id) throw new Error(`Could not resolve id for ${u.email}`);

  await sql`
    update public.profiles
    set role = ${u.role},
        full_name = ${u.name},
        last_location = st_setsrid(st_makepoint(${u.lon}, ${u.lat}), 4326)::geography,
        location_updated_at = now()
    where id = ${id}
  `;
  console.log(`${u.role.padEnd(12)} ${u.email}`);
}

console.log(`\nPassword for all demo users: ${PASSWORD}`);
await sql.end();
