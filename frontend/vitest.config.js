import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{js,jsx,mjs}'],
      exclude: ['src/test/**'],
    },
  },
  resolve: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  define: {
    // Mirror the production-build define in vite.config.js — without
    // this, any future test that imports Settings.jsx (or another
    // module touching __APP_VERSION__) would die with a ReferenceError
    // because vitest doesn't share defines with the vite build config.
    __APP_VERSION__: JSON.stringify('test'),
  },
});
