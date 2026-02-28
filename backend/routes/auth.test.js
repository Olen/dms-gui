import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { TEST_JWT_SECRET, TEST_JWT_SECRET_REFRESH } = vi.hoisted(() => ({
  TEST_JWT_SECRET: 'test-jwt-secret',
  TEST_JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
}));

// Mock all dependencies before importing the module under test
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
    debug: false,
  },
}));

const mockLoginUser = vi.fn();
const mockDbGet = vi.fn();
const mockUpdateDB = vi.fn();
const mockRequestPasswordReset = vi.fn();
const mockValidateResetToken = vi.fn();
const mockExecutePasswordReset = vi.fn();

vi.mock('../logins.mjs', () => ({
  loginUser: (...args) => mockLoginUser(...args),
}));

vi.mock('../db.mjs', () => ({
  sql: {
    logins: {
      select: {
        refreshToken: 'SELECT * FROM logins WHERE id = ? AND refreshToken = @refreshToken',
      },
    },
  },
  dbGet: (...args) => mockDbGet(...args),
  updateDB: (...args) => mockUpdateDB(...args),
}));

vi.mock('../passwordReset.mjs', () => ({
  requestPasswordReset: (...args) => mockRequestPasswordReset(...args),
  validateResetToken: (...args) => mockValidateResetToken(...args),
  executePasswordReset: (...args) => mockExecutePasswordReset(...args),
  cleanupExpiredTokens: vi.fn(),
}));

import jwt from 'jsonwebtoken';
import { createTestApp, adminToken, userToken } from '../test/routeHelper.mjs';
import authRoutes from './auth.js';

const app = createTestApp(authRoutes);


describe('POST /api/loginUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when credential is missing', async () => {
    const res = await request(app)
      .post('/api/loginUser')
      .send({ password: 'test123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/credential/i);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/loginUser')
      .send({ credential: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 401 for invalid credentials', async () => {
    mockLoginUser.mockResolvedValue({ success: false });

    const res = await request(app)
      .post('/api/loginUser')
      .send({ credential: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('returns 200 with user data and sets httpOnly cookies on success', async () => {
    const userMessage = { id: 1, mailbox: 'admin@test.com', isAdmin: 1, isActive: 1, roles: [] };
    mockLoginUser.mockResolvedValue({ success: true, message: userMessage });
    mockUpdateDB.mockReturnValue({ success: true });

    const res = await request(app)
      .post('/api/loginUser')
      .send({ credential: 'admin', password: 'correct' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Check cookies were set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('accessToken');
    expect(cookieStr).toContain('refreshToken');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('returns success without cookies for test login', async () => {
    const userMessage = { id: 1, mailbox: 'admin@test.com', isAdmin: 1, isActive: 1, roles: [] };
    mockLoginUser.mockResolvedValue({ success: true, message: userMessage });

    const res = await request(app)
      .post('/api/loginUser')
      .send({ credential: 'admin', password: 'correct', test: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // No cookies set for test login
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeUndefined();
  });
});


describe('POST /api/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no refresh token cookie', async () => {
    const res = await request(app)
      .post('/api/refresh');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_REFRESH_TOKEN');
  });

  it('returns 403 when token not found in DB', async () => {
    const refreshToken = jwt.sign({ id: 1, mailbox: 'admin@test.com' }, TEST_JWT_SECRET_REFRESH, { expiresIn: '7d' });
    mockDbGet.mockReturnValue({ success: false });

    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('returns 200 with new access token cookie on success', async () => {
    const refreshToken = jwt.sign({ id: 1, mailbox: 'admin@test.com' }, TEST_JWT_SECRET_REFRESH, { expiresIn: '7d' });
    mockDbGet.mockReturnValue({
      success: true,
      message: { id: 1, mailbox: 'admin@test.com', isAdmin: 1, isActive: 1, roles: '[]' },
    });

    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toContain('accessToken');
  });
});


describe('POST /api/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/logout');

    expect(res.status).toBe(401);
  });

  it('clears cookies and returns success when authenticated', async () => {
    mockUpdateDB.mockReturnValue({ success: true });

    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/logged out/i);
  });
});


describe('POST /api/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 even for non-existent email (no info leak)', async () => {
    mockRequestPasswordReset.mockResolvedValue({
      success: true,
      message: 'If that account exists, a reset link has been sent.',
    });

    const res = await request(app)
      .post('/api/forgot-password')
      .send({ email: 'nonexistent@test.com' });

    expect(res.status).toBe(200);
    // Should always return success: true regardless
    expect(res.body.success).toBe(true);
  });

  it('calls requestPasswordReset with email', async () => {
    mockRequestPasswordReset.mockResolvedValue({ success: true, message: 'ok' });

    await request(app)
      .post('/api/forgot-password')
      .send({ email: 'user@test.com' });

    expect(mockRequestPasswordReset).toHaveBeenCalledWith('user@test.com', expect.any(String));
  });
});


describe('POST /api/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when password is missing or too short', async () => {
    const res = await request(app)
      .post('/api/reset-password')
      .send({ token: 'some-token', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/);
  });

  it('returns 200 on successful reset', async () => {
    mockExecutePasswordReset.mockResolvedValue({ success: true, message: 'Password updated' });

    const res = await request(app)
      .post('/api/reset-password')
      .send({ token: 'valid-token', password: 'longpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
