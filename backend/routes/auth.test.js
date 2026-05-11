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

// env is mocked as a mutable object so individual tests can flip
// RESET_BASE_URL on and off. vi.hoisted ensures the const is initialized
// before vi.mock's hoisted factory runs.
const { testEnv } = vi.hoisted(() => ({
  testEnv: {
    JWT_SECRET: 'test-jwt-secret',
    JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
    ACCESS_TOKEN_EXPIRY: '1h',
    REFRESH_TOKEN_EXPIRY: '7d',
    NODE_ENV: 'test',
    isDEMO: false,
    debug: false,
    RESET_BASE_URL: 'https://test.example.com',
  },
}));
vi.mock('../env.mjs', () => ({ env: testEnv }));

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
        refreshToken:
          'SELECT * FROM logins WHERE id = ? AND refreshToken = @refreshToken',
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
    const userMessage = {
      id: 1,
      mailbox: 'admin@test.com',
      isAdmin: 1,
      isActive: 1,
      roles: [],
    };
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
    // CSRF double-submit cookie: xsrfToken issued alongside the
    // auth cookies. Non-httpOnly so axios can read it client-side.
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    const xsrfLine = cookieList.find((c) => c.startsWith('xsrfToken='));
    expect(xsrfLine).toBeDefined();
    expect(xsrfLine).not.toContain('HttpOnly');
  });

  it('returns success without cookies for test login', async () => {
    const userMessage = {
      id: 1,
      mailbox: 'admin@test.com',
      isAdmin: 1,
      isActive: 1,
      roles: [],
    };
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
    const res = await request(app).post('/api/refresh');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_REFRESH_TOKEN');
  });

  it('returns 403 when token not found in DB', async () => {
    const refreshToken = jwt.sign(
      { id: 1, mailbox: 'admin@test.com' },
      TEST_JWT_SECRET_REFRESH,
      { expiresIn: '7d' }
    );
    mockDbGet.mockReturnValue({ success: false });

    const res = await request(app)
      .post('/api/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`]);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('returns 200 with new access token cookie on success', async () => {
    const refreshToken = jwt.sign(
      { id: 1, mailbox: 'admin@test.com' },
      TEST_JWT_SECRET_REFRESH,
      { expiresIn: '7d' }
    );
    mockDbGet.mockReturnValue({
      success: true,
      message: {
        id: 1,
        mailbox: 'admin@test.com',
        isAdmin: 1,
        isActive: 1,
        roles: '[]',
      },
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
    // CSRF cookie rotates alongside the access token so its
    // lifetime stays in lockstep with the auth session.
    const cookieList = Array.isArray(cookies) ? cookies : [cookies];
    const xsrfLine = cookieList.find((c) => c.startsWith('xsrfToken='));
    expect(xsrfLine).toBeDefined();
    expect(xsrfLine).not.toContain('HttpOnly');
  });
});

describe('POST /api/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/logout');

    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated but missing CSRF token', async () => {
    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', [`accessToken=${adminToken}`]);

    // No X-XSRF-TOKEN header / no xsrfToken cookie → 403 from
    // requireCsrf. Unauthenticated requests still 401 (above test);
    // CSRF only applies after authenticateToken passes.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('clears cookies and returns success when authenticated + CSRF tokens match', async () => {
    mockUpdateDB.mockReturnValue({ success: true });
    const csrf = 'matching-csrf-token-value-1234';

    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', [`accessToken=${adminToken}`, `xsrfToken=${csrf}`])
      .set('X-XSRF-TOKEN', csrf);

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

  it('calls requestPasswordReset with email and RESET_BASE_URL', async () => {
    mockRequestPasswordReset.mockResolvedValue({
      success: true,
      message: 'ok',
    });

    await request(app)
      .post('/api/forgot-password')
      .send({ email: 'user@test.com' });

    expect(mockRequestPasswordReset).toHaveBeenCalledWith(
      'user@test.com',
      'https://test.example.com'
    );
  });

  it('refuses to send mail and returns generic success when RESET_BASE_URL is unset', async () => {
    // Simulate an operator forgetting to set RESET_BASE_URL.
    const original = testEnv.RESET_BASE_URL;
    testEnv.RESET_BASE_URL = '';
    try {
      const res = await request(app)
        .post('/api/forgot-password')
        .send({ email: 'user@test.com' });

      expect(res.status).toBe(200);
      // Generic message — same as a non-existent email response. No info leak.
      expect(res.body.success).toBe(true);
      // Critically: requestPasswordReset must NOT have run, so no email was sent.
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    } finally {
      testEnv.RESET_BASE_URL = original;
    }
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
    mockExecutePasswordReset.mockResolvedValue({
      success: true,
      message: 'Password updated',
    });

    const res = await request(app)
      .post('/api/reset-password')
      .send({ token: 'valid-token', password: 'longpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
