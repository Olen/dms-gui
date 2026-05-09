// Integration test for the /docs Swagger guard (#35). Builds a small
// app that mirrors backend/index.js's mount pattern so the auth-gate
// behaviour can be verified end-to-end without standing up the full
// backend bringup.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
}));

vi.mock('./env.mjs', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
    JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
    ACCESS_TOKEN_EXPIRY: '1h',
    REFRESH_TOKEN_EXPIRY: '7d',
    NODE_ENV: 'test',
  },
}));

import {
  authenticateToken,
  requireActive,
  requireAdmin,
} from './middleware.js';
import { adminToken, userToken, inactiveToken } from './test/routeHelper.mjs';

// Build the app with the same gate the real index.js uses, but
// substitute a stub handler for the swagger UI so we don't need
// swaggerUi/oasDefinition during tests.
const buildApp = ({ enableSwagger }) => {
  const app = express();
  app.use(cookieParser());
  if (enableSwagger) {
    const stubHandler = (_req, res) =>
      res.status(200).send('<html>swagger UI</html>');
    app.use(
      '/docs',
      authenticateToken,
      requireActive,
      requireAdmin,
      stubHandler
    );
  }
  return app;
};

describe('Swagger /docs guard (#35)', () => {
  describe('when ENABLE_SWAGGER=false', () => {
    const app = buildApp({ enableSwagger: false });

    it('returns 404 for anonymous requests (no /docs route at all)', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(404);
    });

    it('returns 404 even with admin token', async () => {
      const res = await request(app)
        .get('/docs')
        .set('Cookie', [`accessToken=${adminToken}`]);
      expect(res.status).toBe(404);
    });
  });

  describe('when ENABLE_SWAGGER=true', () => {
    const app = buildApp({ enableSwagger: true });

    it('returns 401 for anonymous requests', async () => {
      const res = await request(app).get('/docs');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/docs')
        .set('Cookie', [`accessToken=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it('returns 403 for inactive accounts (deactivated but token still valid)', async () => {
      const res = await request(app)
        .get('/docs')
        .set('Cookie', [`accessToken=${inactiveToken}`]);
      expect(res.status).toBe(403);
    });

    it('returns 200 for admin users', async () => {
      const res = await request(app)
        .get('/docs')
        .set('Cookie', [`accessToken=${adminToken}`]);
      expect(res.status).toBe(200);
    });
  });
});
