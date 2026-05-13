import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_URL injection: shim into the `process.env.API_URL` literal that
// `src/services/api.mjs` references. Vite's `define` does string-replace
// at build time, so call sites resolve to the env value at compile time
// (no runtime `process` object needed in the browser).
const API_URL = process.env.API_URL || '/api';

// Read the repo-root package.json — the single source of truth for the
// release version per CLAUDE.md ("backend/package.json and
// frontend/package.json are internal-only and stay at 1.0.0"). Calls
// to the literal `__APP_VERSION__` are replaced with the string at
// build time so e.g. the About tab can show the running version
// without a backend round-trip.
const rootPkg = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    'utf8'
  )
);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // sourcemaps off in production to avoid shipping the source tree
    // (nginx would serve any .map next to its .js sibling). Vite injects
    // its own dev sourcemaps automatically under `vite dev`.
  },
  resolve: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  define: {
    // NOT overriding process.env.NODE_ENV — Vite injects that itself
    // based on `mode`/`command`. A manual override here would force
    // 'production' under `vite dev` when NODE_ENV is unset, breaking
    // React's dev warnings and other dev-only behaviour in dependencies.
    'process.env.API_URL': JSON.stringify(API_URL),
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    port: 3000,
    proxy: {
      // Backend mounts every router under `/api` (see backend/index.js).
      // No rewrite — the upstream needs the prefix preserved, otherwise
      // every dev-mode request 404s. Production nginx also preserves
      // the prefix when reverse-proxying.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
