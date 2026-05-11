import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
}));

vi.mock('../env.mjs', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
    JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
    ACCESS_TOKEN_EXPIRY: '1h',
    REFRESH_TOKEN_EXPIRY: '7d',
    NODE_ENV: 'test',
    DMSGUI_CONFIG_PATH: '/tmp',
  },
  plugins: {},
}));

const mockGetConfigs = vi.fn();
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock('../settings.mjs', () => ({
  getConfigs: (...args) => mockGetConfigs(...args),
  getSettings: (...args) => mockGetSettings(...args),
  saveSettings: (...args) => mockSaveSettings(...args),
}));

vi.mock('../db.mjs', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
}));

vi.mock('../demoMode.mjs', () => ({
  demoResponse: vi.fn().mockReturnValue(null),
}));

import { createTestApp } from '../test/routeHelper.mjs';
import jwt from 'jsonwebtoken';
import settingsRoutes from './settings.js';

// Non-admin user with no mailbox roles — the exact shape that
// triggers the getConfigs empty-roles → admin-path bypass.
const rolelessUserToken = jwt.sign(
  {
    id: 99,
    mailbox: 'roleless@test.com',
    username: 'roleless',
    isAdmin: 0,
    isActive: 1,
    roles: [],
  },
  'test-jwt-secret',
  { expiresIn: '1h' }
);

const app = createTestApp(settingsRoutes);

describe('GET /api/configs/:plugin — empty-roles guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-admin + empty-roles on the mailserver plugin with 403', async () => {
    // getConfigs treats an empty roles array as the admin path and
    // returns every container's configs. Without an explicit guard,
    // a non-admin with no mailbox roles would inherit full visibility.
    // The route must reject upfront, before any DB lookup.
    const res = await request(app)
      .get('/api/configs/mailserver')
      .set('Cookie', [`accessToken=${rolelessUserToken}`]);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Permission denied' });
    // getConfigs must NOT have been called — the guard is the
    // early-return, no DB query reaches getConfigs with `[]`.
    expect(mockGetConfigs).not.toHaveBeenCalled();
  });

  it('allows non-admin with empty roles on a non-mailserver plugin', async () => {
    // The guard is mailserver-specific because non-mailserver
    // plugins always pass `[req.user.id]` (length 1) to getConfigs,
    // so they cannot hit the empty-array → admin-path bypass.
    // Verify the guard doesn't over-reach.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'some-host' }],
    });

    const res = await request(app)
      .get('/api/configs/dnscontrol')
      .set('Cookie', [`accessToken=${rolelessUserToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetConfigs).toHaveBeenCalledWith('dnscontrol', [99], undefined);
  });
});
