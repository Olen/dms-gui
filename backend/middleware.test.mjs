import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TEST_JWT_SECRET, TEST_JWT_SECRET_REFRESH } = vi.hoisted(() => ({
  TEST_JWT_SECRET: 'test-jwt-secret',
  TEST_JWT_SECRET_REFRESH: 'test-jwt-refresh-secret',
}));

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
  },
}));

import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  requireAdmin,
  requireActive,
  validateContainerName,
  serverError,
  generateAccessToken,
  generateRefreshToken,
  isValidDomain,
  DOMAIN_RE,
} from './middleware.js';
import { errorLog } from './backend.mjs';

// Helper to create mock req/res/next
const mockReq = (overrides = {}) => ({ cookies: {}, params: {}, ...overrides });
const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
const mockNext = () => vi.fn();


describe('authenticateToken', () => {
  it('returns 401 with NO_TOKEN code when no cookie present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_TOKEN' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 with INVALID_TOKEN code for invalid JWT', () => {
    const req = mockReq({ cookies: { accessToken: 'invalid.token.here' } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_TOKEN' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with TOKEN_EXPIRED code for expired JWT', () => {
    const token = jwt.sign({ id: 1 }, TEST_JWT_SECRET, { expiresIn: '0s' });
    // Wait for token to be expired (immediate with 0s)
    const req = mockReq({ cookies: { accessToken: token } });
    const res = mockRes();
    const next = mockNext();

    // jwt.verify will throw TokenExpiredError for a 0s token
    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('sets req.user from valid JWT and calls next()', () => {
    const payload = { id: 1, mailbox: 'test@test.com', isAdmin: 1, isActive: 1, roles: [] };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq({ cookies: { accessToken: token } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(1);
    expect(req.user.mailbox).toBe('test@test.com');
    expect(req.user.isAdmin).toBe(1);
  });

  it('reads token from req.cookies.accessToken', () => {
    const payload = { id: 5 };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq({ cookies: { accessToken: token } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe(5);
  });

  it('handles missing cookies object gracefully', () => {
    const req = { params: {} }; // no cookies property
    const res = mockRes();
    const next = mockNext();

    // Should not throw, should return error
    expect(() => authenticateToken(req, res, next)).not.toThrow();
    // Either returns 401 (no token) or 403 (error reading cookies)
    expect(res.status).toHaveBeenCalled();
  });

  it('does not leak error details to client', () => {
    const req = mockReq({ cookies: { accessToken: 'bad' } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall).not.toHaveProperty('stack');
    expect(jsonCall).not.toHaveProperty('message', expect.stringContaining('jwt'));
  });

  it('works with valid token payload (isAdmin, isActive, roles)', () => {
    const payload = { id: 1, isAdmin: 1, isActive: 1, roles: ['a@b.com'] };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq({ cookies: { accessToken: token } });
    const res = mockRes();
    const next = mockNext();

    authenticateToken(req, res, next);

    expect(req.user.isAdmin).toBe(1);
    expect(req.user.isActive).toBe(1);
    expect(req.user.roles).toEqual(['a@b.com']);
  });
});


describe('requireAdmin', () => {
  it('calls next() when req.user.isAdmin is truthy', () => {
    const req = mockReq({ user: { isAdmin: 1 } });
    const res = mockRes();
    const next = mockNext();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN when req.user.isAdmin is falsy', () => {
    const req = mockReq({ user: { isAdmin: false } });
    const res = mockRes();
    const next = mockNext();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.isAdmin is 0 (not just false)', () => {
    const req = mockReq({ user: { isAdmin: 0 } });
    const res = mockRes();
    const next = mockNext();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});


describe('requireActive', () => {
  it('calls next() when req.user.isActive is truthy', () => {
    const req = mockReq({ user: { isActive: 1 } });
    const res = mockRes();
    const next = mockNext();

    requireActive(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 ACCOUNT_INACTIVE when inactive', () => {
    const req = mockReq({ user: { isActive: 0 } });
    const res = mockRes();
    const next = mockNext();

    requireActive(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_INACTIVE' }));
  });

  it('returns 403 when req.user is missing', () => {
    const req = mockReq({ user: null });
    const res = mockRes();
    const next = mockNext();

    requireActive(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});


describe('validateContainerName', () => {
  it('calls next() for valid names: mailserver, dms-v15, my.container', () => {
    for (const name of ['mailserver', 'dms-v15', 'my.container']) {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      validateContainerName(req, res, next, name);

      expect(next).toHaveBeenCalled();
    }
  });

  it('returns 400 for names starting with - or .', () => {
    for (const name of ['-bad', '.bad']) {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      validateContainerName(req, res, next, name);

      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('returns 400 for names with spaces or special chars', () => {
    for (const name of ['has space', 'bad!name', 'foo;bar']) {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      validateContainerName(req, res, next, name);

      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('calls next() for empty/null value (pass-through)', () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    validateContainerName(req, res, next, null);

    expect(next).toHaveBeenCalled();
  });
});


describe('serverError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs error message and returns 500 with generic message', () => {
    const res = mockRes();
    const error = new Error('database connection failed');

    serverError(res, 'test context', error);

    expect(errorLog).toHaveBeenCalledWith('test context: database connection failed');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('does not leak error details in response body', () => {
    const res = mockRes();
    const error = new Error('secret internal error details');

    serverError(res, 'ctx', error);

    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall).not.toHaveProperty('stack');
    expect(jsonCall.error).toBe('Internal server error');
    expect(JSON.stringify(jsonCall)).not.toContain('secret internal');
  });
});


describe('generateAccessToken', () => {
  it('contains full user payload', () => {
    const user = { id: 1, mailbox: 'a@b.com', isAdmin: 1, isActive: 1, roles: ['a@b.com'] };
    const token = generateAccessToken(user);
    const decoded = jwt.verify(token, TEST_JWT_SECRET);

    expect(decoded.id).toBe(1);
    expect(decoded.mailbox).toBe('a@b.com');
    expect(decoded.isAdmin).toBe(1);
  });

  it('expires in configured time', () => {
    const user = { id: 1 };
    const token = generateAccessToken(user);
    const decoded = jwt.verify(token, TEST_JWT_SECRET);

    // Token should have exp claim
    expect(decoded.exp).toBeDefined();
    // Expiry should be roughly 1h from now (within 10s tolerance)
    const expectedExp = Math.floor(Date.now() / 1000) + 3600;
    expect(decoded.exp).toBeGreaterThan(expectedExp - 10);
    expect(decoded.exp).toBeLessThan(expectedExp + 10);
  });
});


describe('generateRefreshToken', () => {
  it('contains only id and mailbox (minimal)', () => {
    const user = { id: 1, mailbox: 'a@b.com', isAdmin: 1, isActive: 1, roles: ['a@b.com'] };
    const token = generateRefreshToken(user);
    const decoded = jwt.verify(token, TEST_JWT_SECRET_REFRESH);

    expect(decoded.id).toBe(1);
    expect(decoded.mailbox).toBe('a@b.com');
    expect(decoded).not.toHaveProperty('isAdmin');
    expect(decoded).not.toHaveProperty('isActive');
    expect(decoded).not.toHaveProperty('roles');
  });

  it('uses different secret (refresh secret)', () => {
    const user = { id: 1, mailbox: 'a@b.com' };
    const token = generateRefreshToken(user);

    // Should NOT verify with access token secret
    expect(() => jwt.verify(token, TEST_JWT_SECRET)).toThrow();
    // Should verify with refresh secret
    expect(() => jwt.verify(token, TEST_JWT_SECRET_REFRESH)).not.toThrow();
  });
});


describe('isValidDomain', () => {
  it('returns true for valid domains: example.com, sub.domain.org', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('sub.domain.org')).toBe(true);
    expect(isValidDomain('nytt.no')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidDomain('')).toBe(false);
  });

  it('returns false for domains > 253 chars', () => {
    const long = 'a'.repeat(254);
    expect(isValidDomain(long)).toBe(false);
  });

  it('returns false for domains with invalid chars', () => {
    expect(isValidDomain('bad domain.com')).toBe(false);
    expect(isValidDomain('bad!.com')).toBe(false);
    expect(isValidDomain('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(isValidDomain(null)).toBe(false);
    expect(isValidDomain(undefined)).toBe(false);
    expect(isValidDomain(123)).toBe(false);
  });
});


describe('DOMAIN_RE', () => {
  it('matches valid domain patterns', () => {
    expect(DOMAIN_RE.test('example.com')).toBe(true);
    expect(DOMAIN_RE.test('sub.example.com')).toBe(true);
    expect(DOMAIN_RE.test('test123.org')).toBe(true);
  });

  it('rejects invalid patterns', () => {
    expect(DOMAIN_RE.test('-start.com')).toBe(false);
    expect(DOMAIN_RE.test('end-.com')).toBe(false);
  });
});
