import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './lib/http.js';
import { adminRouter } from './routes/admin.js';
import { adminFeedsRouter } from './routes/adminFeeds.js';
import { adminAnalyticsRouter } from './routes/adminAnalytics.js';
import { adminMetricsRouter } from './routes/adminMetrics.js';
import { adminSettingsRouter } from './routes/adminSettings.js';
import { alertsRouter } from './routes/alerts.js';
import { assignmentsRouter } from './routes/assignments.js';
import { checkinsRouter } from './routes/checkins.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { meRouter } from './routes/me.js';
import { reportsRouter } from './routes/reports.js';
import { resourcesRouter } from './routes/resources.js';
import { roadsRouter, routingRouter } from './routes/roads.js';
import { sheltersRouter } from './routes/shelters.js';
import { signalsRouter } from './routes/signals.js';
import { teamsRouter } from './routes/teams.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS }));
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use('/me', meRouter);
  app.use('/incidents', incidentsRouter);
  app.use('/signals', signalsRouter);
  app.use('/reports', reportsRouter);
  app.use('/checkins', checkinsRouter);
  app.use('/alerts', alertsRouter);
  app.use('/teams', teamsRouter);
  app.use('/assignments', assignmentsRouter);
  app.use('/resources', resourcesRouter);
  app.use('/shelters', sheltersRouter);
  app.use('/roads', roadsRouter);
  app.use('/routing', routingRouter);
  app.use('/admin/feeds', adminFeedsRouter);
  app.use('/admin/settings', adminSettingsRouter);
  app.use('/admin/analytics', adminAnalyticsRouter);
  app.use('/admin/metrics', adminMetricsRouter);
  app.use('/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  return app;
}
