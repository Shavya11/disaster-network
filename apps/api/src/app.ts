import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './lib/http.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { meRouter } from './routes/me.js';
import { adminFeedsRouter } from './routes/adminFeeds.js';
import { signalsRouter } from './routes/signals.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS }));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use('/me', meRouter);
  app.use('/incidents', incidentsRouter);
  app.use('/signals', signalsRouter);
  app.use('/admin/feeds', adminFeedsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  return app;
}
