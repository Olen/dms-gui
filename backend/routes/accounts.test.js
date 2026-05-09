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

const mockGetAccounts = vi.fn();
const mockAddAccount = vi.fn();
const mockDeleteAccount = vi.fn();
const mockDoveadm = vi.fn();
const mockSetQuota = vi.fn();
const mockUpdateDB = vi.fn();

vi.mock('../accounts.mjs', () => ({
  getAccounts: (...args) => mockGetAccounts(...args),
  addAccount: (...args) => mockAddAccount(...args),
  deleteAccount: (...args) => mockDeleteAccount(...args),
  doveadm: (...args) => mockDoveadm(...args),
  setQuota: (...args) => mockSetQuota(...args),
  SUPPORTED_SCHEMAS: new Set(['dms']),
}));

vi.mock('../db.mjs', () => ({
  updateDB: (...args) => mockUpdateDB(...args),
}));

import {
  createTestApp,
  adminToken,
  userToken,
  inactiveToken,
} from '../test/routeHelper.mjs';
import accountRoutes from './accounts.js';

const app = createTestApp(accountRoutes);

describe('GET /api/accounts/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/accounts/mailserver');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is inactive', async () => {
    const res = await request(app)
      .get('/api/accounts/mailserver')
      .set('Cookie', [`accessToken=${inactiveToken}`]);
    expect(res.status).toBe(403);
  });

  it('returns full list for admin users', async () => {
    mockGetAccounts.mockResolvedValue({
      success: true,
      message: [{ mailbox: 'admin@test.com' }, { mailbox: 'user@test.com' }],
    });

    const res = await request(app)
      .get('/api/accounts/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toHaveLength(2);
    // Admin call: getAccounts(containerName, refresh) — no roles filter
    expect(mockGetAccounts).toHaveBeenCalledWith('mailserver', false);
  });

  it('filters by roles for non-admin users', async () => {
    mockGetAccounts.mockResolvedValue({
      success: true,
      message: [{ mailbox: 'user@test.com' }],
    });

    const res = await request(app)
      .get('/api/accounts/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    // Non-admin call: getAccounts(containerName, false, roles)
    expect(mockGetAccounts).toHaveBeenCalledWith('mailserver', false, [
      'user@test.com',
    ]);
  });
});

describe('POST /api/accounts/:schema/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/accounts/dms/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ mailbox: 'new@test.com', password: 'test123' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/accounts/dms/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ mailbox: 'new@test.com' }); // missing password

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 201 on successful creation', async () => {
    mockAddAccount.mockResolvedValue({
      success: true,
      message: 'Account created',
    });

    const res = await request(app)
      .post('/api/accounts/dms/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ mailbox: 'new@test.com', password: 'test123' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /api/accounts/:schema/:containerName/:mailbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .delete('/api/accounts/dms/mailserver/user@test.com')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(403);
  });

  it('returns 200 on successful deletion', async () => {
    mockDeleteAccount.mockResolvedValue({
      success: true,
      message: 'Account deleted',
    });

    const res = await request(app)
      .delete('/api/accounts/dms/mailserver/old@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('passes the schema path param through to deleteAccount (not hardcoded "dms")', async () => {
    // The bug being guarded against here is the *handler* having a
    // hardcoded `'dms'` literal in the deleteAccount() call. Even
    // though `'dms'` is currently the only legal schema, this assertion
    // would catch a regression where someone re-introduces the literal.
    mockDeleteAccount.mockResolvedValue({
      success: true,
      message: 'Account deleted',
    });

    await request(app)
      .delete('/api/accounts/dms/mailserver/old@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(mockDeleteAccount).toHaveBeenCalledWith(
      'dms',
      'mailserver',
      'old@test.com'
    );
  });

  it('rejects unknown schemas with 400 instead of crashing deleteAccount()', async () => {
    // deleteAccount() only initializes `results` when schema==='dms';
    // any other value would slip through and crash with `results.returncode`
    // on an undefined access. The route now allowlist-checks first.
    const res = await request(app)
      .delete('/api/accounts/customschema/mailserver/old@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported schema/i);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it('rejects the legacy 2-segment path (regression guard for issue #38)', async () => {
    // The route used to be registered as `/accounts/:containerName/:mailbox`
    // (only 2 segments after `/accounts/`). The frontend, the Swagger doc,
    // and every sibling accounts route used the 3-segment
    // `/:schema/:containerName/:mailbox` shape, so the frontend's
    // 3-segment requests 404'd — that was the production bug. After this
    // PR the route accepts the 3-segment shape and rejects the legacy
    // 2-segment shape; lock that contract here.
    const res = await request(app)
      .delete('/api/accounts/mailserver/user@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(404);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/accounts/:schema/:containerName/:mailbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows admin to set all fields', async () => {
    mockUpdateDB.mockResolvedValue({ success: true, message: 'Updated' });

    const body = { password: 'newpass', isAdmin: 1, isActive: 1 };
    const res = await request(app)
      .patch('/api/accounts/dms/mailserver/user@test.com')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send(body);

    expect(res.status).toBe(200);
    // Admin passes full body with schema appended
    expect(mockUpdateDB).toHaveBeenCalledWith(
      'accounts',
      'user@test.com',
      expect.objectContaining({ password: 'newpass', schema: 'dms' }),
      'mailserver'
    );
  });

  it('non-admin can update their own mailbox', async () => {
    mockUpdateDB.mockResolvedValue({ success: true, message: 'Updated' });

    const res = await request(app)
      .patch('/api/accounts/dms/mailserver/user@test.com')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ password: 'newpass' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin gets permission denied for other mailboxes', async () => {
    const res = await request(app)
      .patch('/api/accounts/dms/mailserver/other@test.com')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ password: 'newpass' });

    // Permission denials are HTTP 403 with {success:false, error:...} since
    // the response-shape standardisation. Pre-Sprint-3 this returned 200
    // which let frontend code that only checks status silently treat the
    // failure as success.
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Permission denied/i);
  });

  it('returns 400 when mailbox param is missing', async () => {
    // Express won't match the route without the mailbox param,
    // so this will be a 404 (no route matched)
    const res = await request(app)
      .patch('/api/accounts/dms/mailserver/')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ password: 'newpass' });

    // Route won't match → 404
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/accounts/:containerName/:mailbox/quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .put('/api/accounts/mailserver/user@test.com/quota')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ quota: '500M' });

    expect(res.status).toBe(403);
  });

  it('returns 200 on successful quota set', async () => {
    mockSetQuota.mockResolvedValue({ success: true, message: 'Quota set' });
    mockGetAccounts.mockResolvedValue({ success: true, message: [] });

    const res = await request(app)
      .put('/api/accounts/mailserver/user@test.com/quota')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ quota: '500M' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSetQuota).toHaveBeenCalledWith(
      'mailserver',
      'user@test.com',
      '500M'
    );
  });
});
