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

const mockGetAliases = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();
const mockUpdateAlias = vi.fn();
const mockIsUserAliasingAllowed = vi.fn();

vi.mock('../aliases.mjs', () => ({
  getAliases: (...a) => mockGetAliases(...a),
  addAlias: (...a) => mockAddAlias(...a),
  deleteAlias: (...a) => mockDeleteAlias(...a),
  updateAlias: (...a) => mockUpdateAlias(...a),
  isUserAliasingAllowed: (...a) => mockIsUserAliasingAllowed(...a),
}));

import {
  createTestApp,
  adminToken,
  userToken,
  inactiveToken,
} from '../test/routeHelper.mjs';
import aliasRoutes from './aliases.js';

const app = createTestApp(aliasRoutes);

describe('PUT /api/aliases/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .send({ source: 'info@example.com', destination: 'a@example.com' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is inactive', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${inactiveToken}`])
      .send({ source: 'info@example.com', destination: 'a@example.com' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when source is missing', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ destination: 'a@example.com' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when destination is missing', async () => {
    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ source: 'info@example.com' });
    expect(res.status).toBe(400);
  });

  it('admin: calls updateAlias and returns 200', async () => {
    mockUpdateAlias.mockResolvedValue({
      success: true,
      message: 'Alias updated: info@example.com',
    });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({
        source: 'info@example.com',
        destination: 'a@example.com,b@example.com',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpdateAlias).toHaveBeenCalledWith(
      'mailserver',
      'info@example.com',
      'a@example.com,b@example.com'
    );
  });

  it('returns 400 for non-admin when destination string parses to empty list', async () => {
    mockIsUserAliasingAllowed.mockReturnValue(true);

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: ',,,' });

    expect(res.status).toBe(400);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: returns 403 when ALLOW_USER_ALIASES is not set', async () => {
    mockIsUserAliasingAllowed.mockReturnValue(false);

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@test.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: returns 403 when a destination is not in their roles', async () => {
    mockIsUserAliasingAllowed.mockReturnValue(true);

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'someone-else@test.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: returns 403 when source domain differs from destination domain', async () => {
    mockIsUserAliasingAllowed.mockReturnValue(true);

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@other.com' });

    expect(res.status).toBe(403);
    expect(mockUpdateAlias).not.toHaveBeenCalled();
  });

  it('non-admin: succeeds when ALLOW_USER_ALIASES=true and destination is in roles with matching domain', async () => {
    mockIsUserAliasingAllowed.mockReturnValue(true);
    mockUpdateAlias.mockResolvedValue({
      success: true,
      message: 'Alias updated: info@test.com',
    });

    const res = await request(app)
      .put('/api/aliases/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ source: 'info@test.com', destination: 'user@test.com' });

    expect(res.status).toBe(200);
    expect(mockUpdateAlias).toHaveBeenCalledWith(
      'mailserver',
      'info@test.com',
      'user@test.com'
    );
  });
});
