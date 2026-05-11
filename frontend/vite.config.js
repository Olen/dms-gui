import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Inject API_URL the same way the previous webpack DefinePlugin did, so
// `process.env.API_URL` in `src/services/api.mjs` keeps resolving to a
// string literal at build time. This avoids a source-file change just
// to satisfy Vite's `import.meta.env.VITE_*` convention, and keeps the
// existing fallback-to-'/api' behaviour for callers that don't set the
// env var.
const API_URL = process.env.API_URL || '/api';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'production'
    ),
    'process.env.API_URL': JSON.stringify(API_URL),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
