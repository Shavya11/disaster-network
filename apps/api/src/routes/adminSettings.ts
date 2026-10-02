import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { HttpError, parse } from '../lib/http.js';
import { SETTINGS, defaultFor, isSettingKey, refreshSettings, type SettingKey } from '../lib/settings.js';
import { recomputeOpenIncidents } from '../intelligence/correlate.js';
import { ALERT_POLICY, CREDIBILITY } from '../intelligence/config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAuth, requireRole('COORDINATOR', 'ADMIN'));

/** How many independent text-only citizen reports reach this confidence (noisy-OR, c = 0.3 each). */
function reportsForConfidence(target: number): number {
  let n = 1;
  while (1 - (1 - CREDIBILITY.citizenText) ** n < target && n < 50) n++;
  return n;
}

function keyParam(raw: unknown): SettingKey {
  if (typeof raw !== 'string' || !isSettingKey(raw)) {
    throw new HttpError(404, `Unknown setting. Known: ${Object.keys(SETTINGS).join(', ')}`);
  }
  return raw;
}

adminSettingsRouter.get('/', async (_req, res) => {
  await refreshSettings();
  const rows = await sql<{ key: string; updated_at: Date; updated_by_name: string | null }[]>`
    select s.key, s.updated_at, p.full_name as updated_by_name
    from public.settings s left join public.profiles p on p.id = s.updated_by
  `;
  const meta = new Map(rows.map((r) => [r.key, r]));
  res.json(
    Object.fromEntries(
      (Object.keys(SETTINGS) as SettingKey[]).map((key) => [
        key,
        {
          description: SETTINGS[key].description,
          value: SETTINGS[key].target,
          default: defaultFor(key),
          overridden: meta.has(key),
          updated_at: meta.get(key)?.updated_at ?? null,
          updated_by: meta.get(key)?.updated_by_name ?? null,
          ...(key === 'alert_policy' ? { equivalent_text_reports: reportsForConfidence(ALERT_POLICY.watchConfidence) } : {}),
        },
      ]),
    ),
  );
});

async function afterChange() {
  await refreshSettings();
  // Weights and policy change scores; rescore everything still open.
  return recomputeOpenIncidents();
}

adminSettingsRouter.put('/:key', requireRole('ADMIN'), async (req, res) => {
  const key = keyParam(req.params.key);
  const value = parse(SETTINGS[key].schema, req.body);
  const before = structuredClone(SETTINGS[key].target);
  await sql`
    insert into public.settings (key, value, updated_by, updated_at)
    values (${key}, ${sql.json(value as never)}, ${req.user!.id}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  `;
  const rescored = await afterChange();
  await audit(sql, { actorId: req.user!.id, action: 'SETTING_CHANGED', entityType: 'setting', entityId: key, before, after: value });
  res.json({ key, value: SETTINGS[key].target, rescored_incidents: rescored });
});

adminSettingsRouter.delete('/:key', requireRole('ADMIN'), async (req, res) => {
  const key = keyParam(req.params.key);
  const before = structuredClone(SETTINGS[key].target);
  await sql`delete from public.settings where key = ${key}`;
  const rescored = await afterChange();
  await audit(sql, { actorId: req.user!.id, action: 'SETTING_RESET', entityType: 'setting', entityId: key, before, after: defaultFor(key) });
  res.json({ key, value: SETTINGS[key].target, rescored_incidents: rescored });
});
