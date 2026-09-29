import { Router } from 'express';
import { updateLocationSchema, updateProfileSchema, type Profile } from '@dn/shared';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

export const meRouter = Router();
meRouter.use(requireAuth);

async function loadProfile(id: string): Promise<Profile> {
  const [profile] = await sql<Profile[]>`
    select
      p.id, u.email, p.full_name, p.phone, p.role,
      case when p.last_location is null then null
           else json_build_object('lat', st_y(p.last_location::geometry),
                                  'lon', st_x(p.last_location::geometry))
      end as location,
      p.location_updated_at, p.alert_radius_m, p.channels,
      p.telegram_chat_id, p.language, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = ${id}
  `;
  if (!profile) throw new HttpError(404, 'Profile not found');
  return profile;
}

meRouter.get('/', async (req, res) => {
  res.json(await loadProfile(req.user!.id));
});

meRouter.patch('/', async (req, res) => {
  const input = parse(updateProfileSchema, req.body);
  const columns = Object.keys(input) as (keyof typeof input)[];
  if (columns.length > 0) {
    await sql`update public.profiles set ${sql(input, columns)} where id = ${req.user!.id}`;
  }
  res.json(await loadProfile(req.user!.id));
});

// Only the latest position is stored (privacy requirement NFR-8).
meRouter.put('/location', async (req, res) => {
  const { lat, lon } = parse(updateLocationSchema, req.body);
  await sql`
    update public.profiles
    set last_location = st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography,
        location_updated_at = now()
    where id = ${req.user!.id}
  `;
  res.json(await loadProfile(req.user!.id));
});
