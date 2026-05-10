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

const mockGetRspamdBayesUsers = vi.fn();
const mockGetRspamdConfig = vi.fn();
const mockGetRspamdCounters = vi.fn();
const mockGetRspamdHistory = vi.fn();
const mockGetRspamdStats = vi.fn();
const mockGetRspamdUserHistory = vi.fn();
const mockRspamdLearnMessage = vi.fn();
const mockGetDovecotSessions = vi.fn();

vi.mock('../settings.mjs', () => ({
  getRspamdBayesUsers: (...args) => mockGetRspamdBayesUsers(...args),
  getRspamdConfig: (...args) => mockGetRspamdConfig(...args),
  getRspamdCounters: (...args) => mockGetRspamdCounters(...args),
  getRspamdHistory: (...args) => mockGetRspamdHistory(...args),
  getRspamdStats: (...args) => mockGetRspamdStats(...args),
  getRspamdUserHistory: (...args) => mockGetRspamdUserHistory(...args),
  rspamdLearnMessage: (...args) => mockRspamdLearnMessage(...args),
  getDovecotSessions: (...args) => mockGetDovecotSessions(...args),
}));

const mockGenerateAutoconfig = vi.fn();
const mockGenerateMobileconfig = vi.fn();

vi.mock('../mailprofile.mjs', () => ({
  generateAutoconfig: (...args) => mockGenerateAutoconfig(...args),
  generateMobileconfig: (...args) => mockGenerateMobileconfig(...args),
}));

const mockGeneratePassphrase = vi.fn();
vi.mock('../passphrase.mjs', () => ({
  generatePassphrase: (...args) => mockGeneratePassphrase(...args),
}));

const mockDbAll = vi.fn();
vi.mock('../db.mjs', () => ({
  dbAll: (...args) => mockDbAll(...args),
}));

import { createTestApp, adminToken, userToken, inactiveToken } from '../test/routeHelper.mjs';
import mailRoutes from './mail.js';

const app = createTestApp(mailRoutes);

// Shared settings rows used by autoconfig/mobileconfig tests
const settingsRows = [
  { name: 'IMAP_HOST', value: 'imap.test.com' },
  { name: 'SMTP_HOST', value: 'smtp.test.com' },
];

describe('GET /api/mail-profile/:containerName/autoconfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAll.mockReturnValue({ success: true, message: settingsRows });
    mockGenerateAutoconfig.mockReturnValue('<?xml version="1.0"?><autoconfig/>');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/mail-profile/mailserver/autoconfig');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is inactive', async () => {
    const res = await request(app)
      .get('/api/mail-profile/mailserver/autoconfig')
      .set('Cookie', [`accessToken=${inactiveToken}`]);
    expect(res.status).toBe(403);
  });

  it('returns autoconfig XML for authenticated user', async () => {
    const res = await request(app)
      .get('/api/mail-profile/mailserver/autoconfig')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(mockGenerateAutoconfig).toHaveBeenCalledWith(
      'admin@test.com',
      expect.objectContaining({ IMAP_HOST: 'imap.test.com' })
    );
  });

  it('returns 404 when mail server settings are not configured', async () => {
    mockDbAll.mockReturnValue({ success: true, message: [] });

    const res = await request(app)
      .get('/api/mail-profile/mailserver/autoconfig')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 500 when generateAutoconfig throws', async () => {
    mockGenerateAutoconfig.mockImplementation(() => {
      throw new Error('XML generation failed');
    });

    const res = await request(app)
      .get('/api/mail-profile/mailserver/autoconfig')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/mail-profile/:containerName/mobileconfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAll.mockReturnValue({ success: true, message: settingsRows });
    mockGenerateMobileconfig.mockReturnValue('<?xml version="1.0"?><plist/>');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/mail-profile/mailserver/mobileconfig');
    expect(res.status).toBe(401);
  });

  it('returns mobileconfig XML for authenticated user', async () => {
    const res = await request(app)
      .get('/api/mail-profile/mailserver/mobileconfig')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/apple-aspen-config|plist|xml/);
    expect(mockGenerateMobileconfig).toHaveBeenCalledWith(
      'admin@test.com',
      expect.objectContaining({ IMAP_HOST: 'imap.test.com' })
    );
  });

  it('returns 404 when mail server settings are not configured', async () => {
    mockDbAll.mockReturnValue({ success: true, message: [] });

    const res = await request(app)
      .get('/api/mail-profile/mailserver/mobileconfig')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/generate-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGeneratePassphrase.mockReturnValue('word-word-word-word');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/generate-password');
    expect(res.status).toBe(401);
  });

  it('generates a passphrase with default 4 words', async () => {
    const res = await request(app)
      .get('/api/generate-password')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('word-word-word-word');
    // Default 4 words, clamped to 3-8
    expect(mockGeneratePassphrase).toHaveBeenCalledWith(4);
  });

  it('respects the ?words query param (clamped to 3-8)', async () => {
    const res = await request(app)
      .get('/api/generate-password?words=6')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGeneratePassphrase).toHaveBeenCalledWith(6);
  });

  it('clamps words below 3 to 3', async () => {
    const res = await request(app)
      .get('/api/generate-password?words=1')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGeneratePassphrase).toHaveBeenCalledWith(3);
  });

  it('clamps words above 8 to 8', async () => {
    const res = await request(app)
      .get('/api/generate-password?words=20')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGeneratePassphrase).toHaveBeenCalledWith(8);
  });
});

describe('GET /api/rspamd/:containerName/user-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No alias rows by default
    mockDbAll.mockReturnValue({ success: true, message: [] });
    mockGetRspamdUserHistory.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/rspamd/mailserver/user-summary');
    expect(res.status).toBe(401);
  });

  it('returns user rspamd summary for authenticated user', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/user-summary')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdUserHistory).toHaveBeenCalledWith(
      'mailserver',
      'mailserver',
      expect.arrayContaining(['user@test.com'])
    );
  });

  it('includes alias sources in the addresses list', async () => {
    // Return an alias pointing to the user's mailbox
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'alias@test.com' }],
    });

    const res = await request(app)
      .get('/api/rspamd/mailserver/user-summary')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdUserHistory).toHaveBeenCalledWith(
      'mailserver',
      'mailserver',
      expect.arrayContaining(['user@test.com', 'alias@test.com'])
    );
  });

  it('returns 500 when getRspamdUserHistory throws', async () => {
    mockGetRspamdUserHistory.mockRejectedValue(new Error('rspamd unavailable'));

    const res = await request(app)
      .get('/api/rspamd/mailserver/user-summary')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/rspamd/:containerName/stat (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRspamdStats.mockResolvedValue({ success: true, message: { scanned: 100 } });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/rspamd/mailserver/stat');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/stat')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get rspamd stats', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/stat')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdStats).toHaveBeenCalledWith('mailserver', 'mailserver');
  });
});

describe('GET /api/rspamd/:containerName/counters (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRspamdCounters.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/counters')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get rspamd counters', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/counters')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdCounters).toHaveBeenCalledWith('mailserver', 'mailserver');
  });
});

describe('GET /api/rspamd/:containerName/bayes-users (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRspamdBayesUsers.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/bayes-users')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get bayes users', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/bayes-users')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdBayesUsers).toHaveBeenCalledWith('mailserver', 'mailserver');
  });
});

describe('GET /api/rspamd/:containerName/config (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRspamdConfig.mockResolvedValue({ success: true, message: {} });
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/config')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get rspamd config', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/config')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdConfig).toHaveBeenCalledWith('mailserver', 'mailserver');
  });
});

describe('GET /api/rspamd/:containerName/history (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRspamdHistory.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/history')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get rspamd history', async () => {
    const res = await request(app)
      .get('/api/rspamd/mailserver/history')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetRspamdHistory).toHaveBeenCalledWith('mailserver', 'mailserver');
  });
});

describe('POST /api/rspamd/:containerName/learn (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRspamdLearnMessage.mockResolvedValue({ success: true, message: 'Trained' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/rspamd/mailserver/learn')
      .send({ message_id: 'msg1', action: 'spam' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/rspamd/mailserver/learn')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ message_id: 'msg1', action: 'spam' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when message_id or action is missing', async () => {
    const res = await request(app)
      .post('/api/rspamd/mailserver/learn')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ message_id: 'msg1' }); // missing action

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message_id and action/i);
  });

  it('admin can train a message', async () => {
    const res = await request(app)
      .post('/api/rspamd/mailserver/learn')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ message_id: 'msg1', action: 'spam' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockRspamdLearnMessage).toHaveBeenCalledWith(
      'mailserver',
      'mailserver',
      'msg1',
      'spam',
      'admin' // adminPayload.username
    );
  });
});

describe('GET /api/dovecot/:containerName/sessions (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDovecotSessions.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dovecot/mailserver/sessions');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/dovecot/mailserver/sessions')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get dovecot sessions', async () => {
    const res = await request(app)
      .get('/api/dovecot/mailserver/sessions')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetDovecotSessions).toHaveBeenCalledWith('mailserver', 'mailserver');
  });

  it('returns 500 when getDovecotSessions throws', async () => {
    mockGetDovecotSessions.mockRejectedValue(new Error('dovecot unavailable'));

    const res = await request(app)
      .get('/api/dovecot/mailserver/sessions')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});
