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
});
