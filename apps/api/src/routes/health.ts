import { Router } from 'express';
import { sql } from '../lib/db.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const [row] = await sql<{ postgis: string }[]>`select extensions.postgis_version() as postgis`;
  res.json({ ok: true, postgis: row?.postgis ?? null, time: new Date().toISOString() });
});
