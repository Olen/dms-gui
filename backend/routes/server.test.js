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
import jwt from 'jsonwebtoken';
import serverRoutes from './server.js';

// Token for a non-admin with no mailbox roles. Used to lock down the
// "non-admin + empty roles + mailserver" SSRF gate (getConfigs treats
// an empty roles array as the admin path and returns ALL configs).
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

  it('does not let `settings: []` (truthy-but-empty) bypass the containerName presence check', async () => {
    // Regression for the override-detection tightening: an empty
    // array is truthy in JS but carries no actual override. If the
    // route treated it as "override present" and skipped the
    // getConfigs gate, an admin could still probe arbitrary
    // hostnames via the path param because getTargetDict falls back
    // to the DB path when settings.length is 0.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [],
    });

    const res = await request(app)
      .post('/api/status/mailserver/random-host')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ settings: [] });

    expect(res.status).toBe(403);
    expect(mockGetServerStatus).not.toHaveBeenCalled();
    // The DB-presence check ran because hasOverride was false.
    expect(mockGetConfigs).toHaveBeenCalled();
  });

  it('does not let `settings: {}` (truthy non-array) bypass either', async () => {
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [],
    });

    const res = await request(app)
      .post('/api/status/mailserver/random-host')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ settings: {} });

    expect(res.status).toBe(403);
    expect(mockGetConfigs).toHaveBeenCalled();
  });

  it('surfaces a 500 when getConfigs fails (not 403 — operational error vs. permission)', async () => {
    // Without this branch, a DB hiccup during dashboard polling
    // would mask as 403 Permission denied to every user, which is
    // both misleading and breaks legitimate access.
    mockGetConfigs.mockResolvedValue({
      success: false,
      error: 'database is locked',
    });

    const res = await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR',
    });
    // The raw DB error must NOT leak in the response body — it's a
    // server-internal detail. It is still logged server-side via
    // serverError's errorLog call, which the test asserts separately
    // via the mocked errorLog spy in unit-level coverage.
    expect(JSON.stringify(res.body)).not.toContain('database is locked');
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

  it('non-admin getConfigs for mailserver plugin is filtered by req.user.roles', async () => {
    await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});

    // userPayload.roles is ['user@test.com']
    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', [
      'user@test.com',
    ]);
  });

  it('non-admin getConfigs for non-mailserver plugins is filtered by [req.user.id]', async () => {
    // Settings.js's existing pattern: mailserver = roles (mailboxes);
    // other plugins = login id. Mirrored here so non-mailserver
    // status checks don't false-403 for users who don't have
    // mailbox roles for those plugins' configs.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'some-host' }],
    });

    await request(app)
      .post('/api/status/dns-control/some-host')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});

    // userPayload.id is 2
    expect(mockGetConfigs).toHaveBeenCalledWith('dns-control', [2]);
  });

  it('returns 403 for a non-admin with empty roles on the mailserver plugin', async () => {
    // Regression for the empty-roles bypass: getConfigs's contract
    // treats an empty roles array as the admin path and returns ALL
    // configs. Without an explicit guard, a non-admin with no
    // mailbox roles would inherit admin-level visibility into
    // every container's status. The route must reject upfront.
    const res = await request(app)
      .post('/api/status/mailserver/dms')
      .set('Cookie', [`accessToken=${rolelessUserToken}`])
      .send({});

    expect(res.status).toBe(403);
    // Crucially, getConfigs must NOT have been called — the empty-
    // roles guard is the early-return, before any DB lookup.
    expect(mockGetConfigs).not.toHaveBeenCalled();
    expect(mockGetServerStatus).not.toHaveBeenCalled();
  });

  it('still allows non-admin with empty roles on a non-mailserver plugin (scope is [user.id])', async () => {
    // The empty-roles guard is mailserver-specific because non-
    // mailserver plugins always pass [req.user.id] (length 1) to
    // getConfigs, so they don't hit the empty-array → admin-path
    // bypass. Verify the empty-roles guard doesn't over-reach.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'some-host' }],
    });

    await request(app)
      .post('/api/status/dns-control/some-host')
      .set('Cookie', [`accessToken=${rolelessUserToken}`])
      .send({});

    expect(mockGetConfigs).toHaveBeenCalledWith('dns-control', [99]);
    expect(mockGetServerStatus).toHaveBeenCalledOnce();
  });
});

describe('GET /api/envs/:plugin/:containerName — container-scoping authorization', () => {
  // Same container-scoping gate as POST /status: any active user could
  // otherwise retrieve the parsed DMS environment of an arbitrary
  // container by varying the path param. The route must verify the
  // requested containerName is in the caller's accessible config set
  // (and reject the empty-roles → admin-path bypass) before calling
  // getServerEnvs. There is no settings-override path here.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerEnvs.mockResolvedValue({
      success: true,
      message: [{ name: 'DOVECOT_FTS_PLUGIN', value: 'xapian' }],
    });
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'dms', plugin: 'mailserver' }],
    });
  });

  it('returns 403 when a non-admin requests a containerName not in their roles', async () => {
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'other-container' }],
    });

    const res = await request(app)
      .get('/api/envs/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(403);
    expect(mockGetServerEnvs).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin with empty roles on the mailserver plugin (no getConfigs call)', async () => {
    // getConfigs treats an empty roles array as the admin path and
    // returns ALL configs — the route must reject upfront before any
    // DB lookup, same as /status.
    const res = await request(app)
      .get('/api/envs/mailserver/dms')
      .set('Cookie', [`accessToken=${rolelessUserToken}`]);

    expect(res.status).toBe(403);
    expect(mockGetConfigs).not.toHaveBeenCalled();
    expect(mockGetServerEnvs).not.toHaveBeenCalled();
  });

  it('returns 500 when getConfigs fails (operational error, not 403)', async () => {
    mockGetConfigs.mockResolvedValue({
      success: false,
      error: 'database is locked',
    });

    const res = await request(app)
      .get('/api/envs/mailserver/dms')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('database is locked');
    expect(mockGetServerEnvs).not.toHaveBeenCalled();
  });

  it('admin reaches getServerEnvs for a configured container (getConfigs scoped with [])', async () => {
    const res = await request(app)
      .get('/api/envs/mailserver/dms')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', []);
    expect(mockGetServerEnvs).toHaveBeenCalledOnce();
  });

  it('non-admin with a matching role reaches getServerEnvs (getConfigs scoped by roles)', async () => {
    const res = await request(app)
      .get('/api/envs/mailserver/dms')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', [
      'user@test.com',
    ]);
    expect(mockGetServerEnvs).toHaveBeenCalledOnce();
  });

  it('non-admin on a non-mailserver plugin is scoped by [req.user.id]', async () => {
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'some-host' }],
    });

    const res = await request(app)
      .get('/api/envs/dns-control/some-host')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetConfigs).toHaveBeenCalledWith('dns-control', [2]);
    expect(mockGetServerEnvs).toHaveBeenCalledOnce();
  });
});
