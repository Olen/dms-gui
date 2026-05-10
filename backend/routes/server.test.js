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
  },
}));

const mockGetServerStatus = vi.fn();
const mockGetServerEnvs = vi.fn();
const mockGetNodeInfos = vi.fn();
const mockGetMailLogs = vi.fn();
const mockGetMailBounces = vi.fn();
const mockInitAPI = vi.fn();
const mockKillContainer = vi.fn();

vi.mock('../settings.mjs', () => ({
  getServerStatus: (...args) => mockGetServerStatus(...args),
  getServerEnvs: (...args) => mockGetServerEnvs(...args),
  getNodeInfos: (...args) => mockGetNodeInfos(...args),
  getMailLogs: (...args) => mockGetMailLogs(...args),
  getMailBounces: (...args) => mockGetMailBounces(...args),
  initAPI: (...args) => mockInitAPI(...args),
  killContainer: (...args) => mockKillContainer(...args),
}));

vi.mock('../db.mjs', () => ({
  dbCount: vi.fn(),
}));

import { createTestApp, adminToken, userToken } from '../test/routeHelper.mjs';
import serverRoutes from './server.js';

const app = createTestApp(serverRoutes);

describe('POST /api/status/:plugin/:containerName — settings override (SSRF gate)', () => {
  // Regression coverage for code-scanning alert #68 (js/request-forgery).
  // The route accepts a `settings` body that is fed straight into
  // getTargetDict and used to construct the URL fetch() hits. The flow
  // is by-design for FormContainerAdd's first-time setup, but it must
  // be admin-only — a non-admin authenticated caller passing arbitrary
  // host/port/protocol would otherwise weaponise the dms-gui server
  // into making outbound requests against internal targets.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerStatus.mockResolvedValue({
      success: true,
      message: { status: { status: 'running' } },
    });
  });

  it('passes through the user-supplied settings for admin callers', async () => {
    const userSettings = [
      { name: 'protocol', value: 'http' },
      { name: 'containerName', value: 'mailserver' },
      { name: 'DMS_API_PORT', value: '8888' },
    ];
    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ settings: userSettings });

    expect(mockGetServerStatus).toHaveBeenCalledOnce();
    const [, , , forwardedSettings] = mockGetServerStatus.mock.calls[0];
    expect(forwardedSettings).toEqual(userSettings);
  });

  it('drops the settings body for non-admin callers', async () => {
    const userSettings = [
      // What an attacker would supply to redirect the outbound fetch:
      { name: 'protocol', value: 'http' },
      { name: 'containerName', value: '169.254.169.254' },
      { name: 'DMS_API_PORT', value: '80' },
      { name: 'DMS_API_KEY', value: 'attacker-controlled' },
    ];
    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ settings: userSettings });

    // The route still runs (non-admins can ping their existing
    // container), but the forwarded settings must be undefined so
    // getServerStatus falls through to the DB-stored target dict.
    expect(mockGetServerStatus).toHaveBeenCalledOnce();
    const [, , , forwardedSettings] = mockGetServerStatus.mock.calls[0];
    expect(forwardedSettings).toBeUndefined();
  });
});
