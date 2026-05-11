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
    isDEMO: false,
  },
}));

const mockGetRoles = vi.fn();
const mockGetLogins = vi.fn();
const mockAddLogin = vi.fn();

vi.mock('../logins.mjs', () => ({
  getRoles: (...args) => mockGetRoles(...args),
  getLogins: (...args) => mockGetLogins(...args),
  addLogin: (...args) => mockAddLogin(...args),
}));

const mockDeleteEntry = vi.fn();
const mockUpdateDB = vi.fn();

vi.mock('../db.mjs', () => ({
  deleteEntry: (...args) => mockDeleteEntry(...args),
  updateDB: (...args) => mockUpdateDB(...args),
}));

vi.mock('../demoMode.mjs', () => ({
  demoWriteResponse: vi.fn(() => null),
}));

import { createTestApp, adminToken, userToken, inactiveToken } from '../test/routeHelper.mjs';
import loginsRoutes from './logins.js';

const app = createTestApp(loginsRoutes);

describe('GET /api/roles/:credential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/roles/admin@test.com');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is inactive', async () => {
    const res = await request(app)
      .get('/api/roles/admin@test.com')
      .set('Cookie', [`accessToken=${inactiveToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get roles for any credential', async () => {
    mockGetRoles.mockResolvedValue({ success: true, message: ['user@test.com'] });

    const res = await request(app)
      .get('/api/roles/user@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRoles).toHaveBeenCalledWith('user@test.com');
  });

  it('non-admin can get roles for their own mailbox', async () => {
    mockGetRoles.mockResolvedValue({ success: true, message: ['user@test.com'] });

    const res = await request(app)
      .get('/api/roles/user@test.com')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRoles).toHaveBeenCalledWith('user@test.com');
  });

  it('non-admin gets 403 when requesting roles for another mailbox', async () => {
    const res = await request(app)
      .get('/api/roles/admin@test.com')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(403);
    expect(mockGetRoles).not.toHaveBeenCalled();
  });

  it('returns 500 when getRoles throws', async () => {
    mockGetRoles.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/roles/user@test.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/getLogins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/getLogins').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/getLogins')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 403 when inactive', async () => {
    const res = await request(app)
      .post('/api/getLogins')
      .set('Cookie', [`accessToken=${inactiveToken}`])
      .send({});
    expect(res.status).toBe(403);
  });

  it('admin can get all logins', async () => {
    mockGetLogins.mockResolvedValue([
      { id: 1, mailbox: 'admin@test.com' },
      { id: 2, mailbox: 'user@test.com' },
    ]);

    const res = await request(app)
      .post('/api/getLogins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(mockGetLogins).toHaveBeenCalledWith(undefined);
  });

  it('admin can get specific logins by ids', async () => {
    mockGetLogins.mockResolvedValue([{ id: 1, mailbox: 'admin@test.com' }]);

    const res = await request(app)
      .post('/api/getLogins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ ids: [1] });

    expect(res.status).toBe(200);
    expect(mockGetLogins).toHaveBeenCalledWith([1]);
  });

  it('returns 500 when getLogins throws', async () => {
    mockGetLogins.mockRejectedValue(new Error('DB failure'));

    const res = await request(app)
      .post('/api/getLogins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(res.status).toBe(500);
  });
});

describe('PUT /api/logins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/api/logins').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ mailbox: 'new@test.com', username: 'new', password: 'pass123' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when mailbox is missing', async () => {
    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ username: 'new', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mailbox/i);
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ mailbox: 'new@test.com', password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ mailbox: 'new@test.com', username: 'new' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('admin creates a login and returns 201', async () => {
    mockAddLogin.mockResolvedValue({ id: 3, mailbox: 'new@test.com' });

    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        mailbox: 'new@test.com',
        username: 'newuser',
        password: 'secret123',
        email: 'new@ext.com',
        isAdmin: 0,
        isActive: 1,
        roles: [],
      });

    expect(res.status).toBe(201);
    expect(mockAddLogin).toHaveBeenCalledWith(
      'new@test.com',
      'newuser',
      'secret123',
      'new@ext.com',
      0,
      undefined,
      1,
      undefined,
      []
    );
  });

  it('returns 500 when addLogin throws', async () => {
    mockAddLogin.mockRejectedValue(new Error('Duplicate entry'));

    const res = await request(app)
      .put('/api/logins')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ mailbox: 'x@test.com', username: 'x', password: 'pass' });

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/logins/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/api/logins/1').send({});
    expect(res.status).toBe(401);
  });

  it('admin can update any login with all fields', async () => {
    mockUpdateDB.mockResolvedValue({ success: true, message: 'Updated' });

    const res = await request(app)
      .patch('/api/logins/2')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ password: 'newpass', isAdmin: 1, isActive: 1 });

    expect(res.status).toBe(200);
    expect(mockUpdateDB).toHaveBeenCalledWith('logins', '2', {
      password: 'newpass',
      isAdmin: 1,
      isActive: 1,
    });
  });

  it('non-admin can update their own login (only safe fields)', async () => {
    mockUpdateDB.mockResolvedValue({ success: true, message: 'Updated' });

    // userPayload has id=2
    const res = await request(app)
      .patch('/api/logins/2')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ password: 'newpass', isAdmin: 1, isActive: 0, roles: ['other'] });

    expect(res.status).toBe(200);
    // Privilege fields stripped
    expect(mockUpdateDB).toHaveBeenCalledWith('logins', '2', { password: 'newpass' });
  });

  it('non-admin gets 403 when updating another user', async () => {
    const res = await request(app)
      .patch('/api/logins/99')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ password: 'newpass' });

    expect(res.status).toBe(403);
    expect(mockUpdateDB).not.toHaveBeenCalled();
  });

  it('returns 500 when updateDB throws', async () => {
    mockUpdateDB.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch('/api/logins/1')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ password: 'x' });

    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/logins/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/logins/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .delete('/api/logins/1')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can delete a login', async () => {
    mockDeleteEntry.mockResolvedValue({ success: true, message: 'Deleted' });

    const res = await request(app)
      .delete('/api/logins/2')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteEntry).toHaveBeenCalledWith('logins', '2');
  });

  it('returns 500 when deleteEntry throws', async () => {
    mockDeleteEntry.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete('/api/logins/1')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});
