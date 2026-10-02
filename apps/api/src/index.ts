import { createApp } from './app.js';
import { env } from './config/env.js';
import { fillPlaceNamesSoon } from './lib/geocode.js';
import { refreshSettings } from './lib/settings.js';

const SETTINGS_REFRESH_MS = 60_000;
const PLACE_NAME_SWEEP_MS = 120_000;

await refreshSettings();
// Picks up changes made by another instance or directly in the database.
setInterval(() => refreshSettings().catch((err) => console.error('Settings refresh failed', err)), SETTINGS_REFRESH_MS).unref();
setInterval(fillPlaceNamesSoon, PLACE_NAME_SWEEP_MS).unref();
fillPlaceNamesSoon();

createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
