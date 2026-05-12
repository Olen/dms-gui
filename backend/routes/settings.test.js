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
    DMSGUI_CONFIG_PATH: '/tmp/test-settings-uploads',
  },
  plugins: {
    dnscontrol: {
      cloudflare: { apitoken: '' },
    },
  },
}));

const mockGetConfigs = vi.fn();
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();
const mockGetUserConfigDict = vi.fn();
const mockGetWebmailUrl = vi.fn();

vi.mock('../settings.mjs', () => ({
  getConfigs: (...args) => mockGetConfigs(...args),
  getSettings: (...args) => mockGetSettings(...args),
  saveSettings: (...args) => mockSaveSettings(...args),
  getUserConfigDict: (...args) => mockGetUserConfigDict(...args),
  getWebmailUrl: (...args) => mockGetWebmailUrl(...args),
}));

const mockFindAliasesForMailbox = vi.fn();
vi.mock('../aliases.mjs', () => ({
  findAliasesForMailbox: (...args) => mockFindAliasesForMailbox(...args),
}));

vi.mock('../demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
}));

import {
  createTestApp,
  adminToken,
  userToken,
  inactiveToken,
} from '../test/routeHelper.mjs';
import settingsRoutes from './settings.js';

const app = createTestApp(settingsRoutes);

describe('GET /api/branding (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      success: true,
      message: [
        { name: 'brandName', value: 'MyMail' },
        { name: 'brandColorPrimary', value: '#123456' },
      ],
    });
    mockGetWebmailUrl.mockReturnValue(null);
  });

  it('returns branding data without authentication', async () => {
    const res = await request(app).get('/api/branding');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'brandName', value: 'MyMail' }),
      ])
    );
  });

  it('returns branding for a specific container', async () => {
    const res = await request(app).get('/api/branding/mailserver');

    expect(res.status).toBe(200);
    expect(mockGetSettings).toHaveBeenCalledWith('dms-gui', 'mailserver');
  });

  it('falls back to global branding when container has no branding keys', async () => {
    // First call (container-specific) returns non-branding settings
    // Second call (_global) returns branding
    mockGetSettings
      .mockReturnValueOnce({
        success: true,
        message: [{ name: 'DMS_API_KEY', value: 'key' }],
      })
      .mockReturnValueOnce({
        success: true,
        message: [{ name: 'brandName', value: 'Global' }],
      });

    const res = await request(app).get('/api/branding/mailserver');

    expect(res.status).toBe(200);
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
    expect(mockGetSettings).toHaveBeenLastCalledWith('dms-gui', '_global');
  });

  it('includes webmailUrl when configured', async () => {
    mockGetWebmailUrl.mockReturnValue('https://webmail.example.com');

    const res = await request(app).get('/api/branding');

    expect(res.status).toBe(200);
    const webmail = res.body.message.find((m) => m.name === 'webmailUrl');
    expect(webmail).toBeDefined();
    expect(webmail.value).toBe('https://webmail.example.com');
  });

  it('returns empty message array gracefully when settings fail', async () => {
    mockGetSettings.mockImplementation(() => {
      throw new Error('DB down');
    });

    const res = await request(app).get('/api/branding');

    // Fail silently — returns 200 with empty message
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toEqual([]);
  });
});

describe('GET /api/settings/:plugin/:containerName/:scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      success: true,
      message: [{ name: 'DMS_API_KEY', value: 'secretkey' }],
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/settings/dms-gui/mailserver/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 when inactive', async () => {
    const res = await request(app)
      .get('/api/settings/dms-gui/mailserver/1')
      .set('Cookie', [`accessToken=${inactiveToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get settings for any scope', async () => {
    const res = await request(app)
      .get('/api/settings/dms-gui/mailserver/dms-gui')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetSettings).toHaveBeenCalledWith(
      'dms-gui',
      'mailserver',
      null,
      false
    );
  });

  it('non-admin can get their own settings (scope matches user id)', async () => {
    // userPayload.id = 2, so scope '2' matches
    const res = await request(app)
      .get('/api/settings/dms-gui/mailserver/2')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetSettings).toHaveBeenCalled();
  });

  it("non-admin cannot get another user's settings", async () => {
    // userPayload.id = 2, scope '99' doesn't match
    const res = await request(app)
      .get('/api/settings/dms-gui/mailserver/99')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(403);
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('passes ?name query param to getSettings', async () => {
    const res = await request(app)
      .get('/api/settings/dms-gui/mailserver/dms-gui?name=DMS_API_KEY')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetSettings).toHaveBeenCalledWith(
      'dms-gui',
      'mailserver',
      'DMS_API_KEY',
      false
    );
  });
});

describe('GET /api/user-settings/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserConfigDict.mockReturnValue({
      IMAP_HOST: 'imap.test.com',
      ALLOW_USER_ALIASES: 'true',
    });
    mockFindAliasesForMailbox.mockReturnValue({ count: 3 });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/user-settings/mailserver');
    expect(res.status).toBe(401);
  });

  it('returns public user settings for authenticated user', async () => {
    const res = await request(app)
      .get('/api/user-settings/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatchObject({
      IMAP_HOST: 'imap.test.com',
      ALLOW_USER_ALIASES: 'true',
    });
  });

  it('includes alias count for user with mailbox', async () => {
    const res = await request(app)
      .get('/api/user-settings/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.message.USER_ALIAS_COUNT).toBe(3);
    // Scoped to the URL's containerName so the count doesn't leak
    // alias rows from another mailserver container.
    expect(mockFindAliasesForMailbox).toHaveBeenCalledWith(
      'mailserver',
      'user@test.com',
      { count: true }
    );
  });

  it('omits USER_ALIAS_COUNT when the alias lookup fails', async () => {
    // count === null signals a DB failure inside findAliasesForMailbox.
    // The endpoint must NOT show "0" — that would misrepresent unknown
    // as zero in the UI.
    mockFindAliasesForMailbox.mockReturnValue({ count: null });

    const res = await request(app)
      .get('/api/user-settings/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.message.USER_ALIAS_COUNT).toBeUndefined();
  });

  it('filters out non-public keys', async () => {
    mockGetUserConfigDict.mockReturnValue({
      DMS_API_KEY: 'secret', // should NOT be returned
      WEBMAIL_URL: 'https://webmail.test.com', // public
    });
    mockFindAliasesForMailbox.mockReturnValue({ count: 0 });

    const res = await request(app)
      .get('/api/user-settings/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.message.DMS_API_KEY).toBeUndefined();
    expect(res.body.message.WEBMAIL_URL).toBe('https://webmail.test.com');
  });
});

describe('GET /api/configs/:plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [{ value: 'mailserver', plugin: 'mailserver' }],
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/configs/mailserver');
    expect(res.status).toBe(401);
  });

  it('admin gets all mailserver configs (empty roles scope)', async () => {
    const res = await request(app)
      .get('/api/configs/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetConfigs).toHaveBeenCalledWith('mailserver', [], undefined);
  });

  it('non-admin gets mailserver configs filtered by roles', async () => {
    const res = await request(app)
      .get('/api/configs/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    // userPayload.roles = ['user@test.com']
    expect(mockGetConfigs).toHaveBeenCalledWith(
      'mailserver',
      ['user@test.com'],
      undefined
    );
  });

  it('non-mailserver plugin returns template entries from plugins', async () => {
    const res = await request(app)
      .get('/api/configs/dnscontrol')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    // Should return template entries from plugins.dnscontrol
    expect(res.body.success).toBe(true);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'cloudflare' })])
    );
  });

  it('filters template entries by name for non-mailserver plugin', async () => {
    const res = await request(app)
      .get('/api/configs/dnscontrol/cloudflare')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.message).toHaveLength(1);
    expect(res.body.message[0].name).toBe('cloudflare');
  });

  it('returns 500 when getConfigs throws', async () => {
    mockGetConfigs.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/configs/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/settings/:plugin/:schema/:scope/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveSettings.mockResolvedValue({
      success: true,
      message: 'Settings saved',
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/settings/dms-gui/dms/dms-gui/mailserver')
      .send([{ name: 'DMS_API_KEY', value: 'newkey' }]);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/settings/dms-gui/dms/dms-gui/mailserver')
      .set('Cookie', [`accessToken=${userToken}`])
      .send([{ name: 'DMS_API_KEY', value: 'newkey' }]);
    expect(res.status).toBe(403);
  });

  it('admin can save settings and gets 201', async () => {
    const body = [{ name: 'DMS_API_KEY', value: 'newkey' }];

    const res = await request(app)
      .post('/api/settings/dms-gui/dms/dms-gui/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledWith(
      'dms-gui',
      'dms',
      'dms-gui',
      'mailserver',
      body,
      false
    );
  });

  it('passes ?encrypted query param to saveSettings', async () => {
    const body = [{ name: 'secret', value: 'value' }];

    const res = await request(app)
      .post(
        '/api/settings/dnscontrol/cloudflare/dms-gui/mailserver?encrypted=true'
      )
      .set('Cookie', [`accessToken=${adminToken}`])
      .send(body);

    expect(res.status).toBe(201);
    expect(mockSaveSettings).toHaveBeenCalledWith(
      'dnscontrol',
      'cloudflare',
      'dms-gui',
      'mailserver',
      body,
      true
    );
  });

  it('returns 500 when saveSettings throws', async () => {
    mockSaveSettings.mockRejectedValue(new Error('DB write failed'));

    const res = await request(app)
      .post('/api/settings/dms-gui/dms/dms-gui/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send([{ name: 'x', value: 'y' }]);

    expect(res.status).toBe(500);
  });
});
