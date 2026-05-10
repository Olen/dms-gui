// Bootstrap: load /app/config/.dms-gui.env into process.env exactly once,
// before any module reads from process.env. ES modules evaluate side-effect
// imports in source order; both env.mjs and restApiManifest.mjs import this
// module first so DMS_CONFIG_PATH (and any other operator-set value) is
// populated before either module's body executes.
//
// Safe to call dotenv.config() more than once: it re-reads the file each
// time, but with the default `override: false` it does not overwrite
// values already in process.env (set by the shell, docker-compose env,
// or a previous call). ES modules cache this bootstrap module after the
// first import, so in practice the file is read once per process.
import dotenv from 'dotenv';
dotenv.config({ path: '/app/config/.dms-gui.env' });
