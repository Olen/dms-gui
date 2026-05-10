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
const mockGetConfigs = vi.fn();

vi.mock('../settings.mjs', () => ({
  getConfigs: (...args) => mockGetConfigs(...args),
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

describe('POST /api/status/:plugin/:containerName — SSRF gates (CodeQL #68)', () => {
  // Two related defenses against `js/request-forgery`:
  //   1. The user-supplied `settings` body is admin-only — non-admins
  //      cannot inject host/port/protocol values straight into the
  //      URL fetch() hits.
  //   2. When no settings override is supplied, the route checks that
  //      `containerName` is in the caller's accessible config set
  //      before letting getServerStatus issue a ping — otherwise an
  //      authenticated user could probe arbitrary hostnames just by
  //      varying the path param.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerStatus.mockResolvedValue({
      success: true,
      message: { status: { status: 'running' } },
    });
    // Default: 'dms' is configured. Override per-test as needed.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'dms', plugin: 'mailserver' }],
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
    // Settings-supplied path skips the DB-presence check (admin
    // testing a NEW container that isn't yet in the DB).
    expect(mockGetConfigs).not.toHaveBeenCalled();
  });

  it('drops the settings body for non-admin callers', async () => {
    const userSettings = [
      { name: 'protocol', value: 'http' },
      { name: 'containerName', value: '169.254.169.254' },
      { name: 'DMS_API_PORT', value: '80' },
      { name: 'DMS_API_KEY', value: 'attacker-controlled' },
    ];
    // For the non-admin path, getConfigs is filtered by req.user.roles
    // — make 'dms' visible so the DB-presence check passes and we
    // can verify the settings drop separately.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'dms' }],
    });

    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ settings: userSettings });

    expect(mockGetServerStatus).toHaveBeenCalledOnce();
    const [, , , forwardedSettings] = mockGetServerStatus.mock.calls[0];
    expect(forwardedSettings).toBeUndefined();
  });

  it('returns 403 when non-admin requests a containerName not in their roles', async () => {
    // getConfigs(plugin, roles) returns only configs the user can see;
    // when 'dms' is not visible, the DB-presence check rejects.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'other-container' }],
    });

    const res = await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});

    expect(res.status).toBe(403);
    expect(mockGetServerStatus).not.toHaveBeenCalled();
  });

  it('returns 403 when admin requests a containerName not in any config', async () => {
    // Admins also get gated when there is no settings override:
    // probing arbitrary hostnames isn't valuable for an admin either,
    // and the FormContainerAdd path always supplies settings.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [],
    });

    const res = await request(app)
      .post('/api/status/mailserver/random-host')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(res.status).toBe(403);
    expect(mockGetServerStatus).not.toHaveBeenCalled();
  });

  it('admin without settings on a configured container reaches getServerStatus', async () => {
    // Existing happy path for the dashboard polling: admin loads the
    // status of a container they already configured.
    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', []);
    expect(mockGetServerStatus).toHaveBeenCalledOnce();
  });

  it('non-admin getConfigs is filtered by req.user.roles', async () => {
    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});

    // userPayload.roles is ['user@test.com']
    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', [
      'user@test.com',
    ]);
  });
});
