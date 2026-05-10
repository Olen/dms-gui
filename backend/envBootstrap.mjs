// Bootstrap: load /app/config/.dms-gui.env into process.env exactly once,
// before any module reads from process.env. ES modules evaluate side-effect
// imports in source order; both env.mjs and restApiManifest.mjs import this
// module first so DMS_CONFIG_PATH (and any other operator-set value) is
// populated before either module's body executes.
//
// dotenv.config() is idempotent — calling it multiple times is a no-op
// after the first load (default `override: false`).
import dotenv from 'dotenv';
dotenv.config({ path: '/app/config/.dms-gui.env' });
