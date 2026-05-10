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
    DMSGUI_CONFIG_PATH: '/tmp/test-uploads-domains',
  },
  plugins: {
    dnscontrol: {
      cloudflare: { apitoken: '' },
      domeneshop: { token: '', secret: '' },
    },
  },
}));

const mockDnsLookup = vi.fn();
const mockDnsblCheck = vi.fn();
const mockGenerateDkim = vi.fn();
const mockGetDkimSelector = vi.fn();
const mockGetDomains = vi.fn();

vi.mock('../settings.mjs', () => ({
  dnsLookup: (...args) => mockDnsLookup(...args),
  dnsblCheck: (...args) => mockDnsblCheck(...args),
  generateDkim: (...args) => mockGenerateDkim(...args),
  getDkimSelector: (...args) => mockGetDkimSelector(...args),
  getDomains: (...args) => mockGetDomains(...args),
}));

const mockUpdateDB = vi.fn();
const mockDbRun = vi.fn();

vi.mock('../db.mjs', () => ({
  updateDB: (...args) => mockUpdateDB(...args),
  dbRun: (...args) => mockDbRun(...args),
}));

const mockUpsertDnsRecord = vi.fn();
vi.mock('../dnsProviders.mjs', () => ({
  upsertDnsRecord: (...args) => mockUpsertDnsRecord(...args),
}));

vi.mock('../demoMode.mjs', () => ({
  demoWriteResponse: vi.fn(() => null),
}));

import { createTestApp, adminToken, userToken, inactiveToken } from '../test/routeHelper.mjs';
import domainsRoutes from './domains.js';

const app = createTestApp(domainsRoutes);

describe('POST /api/dnscontrol/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/test')
      .send({ type: 'cloudflare', apitoken: 'tok' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/test')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ type: 'cloudflare', apitoken: 'tok' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when provider type is missing', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/test')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ apitoken: 'tok' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Provider type/i);
  });

  it('returns error for unsupported provider type', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/test')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ type: 'unsupported_provider' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not implemented/i);
  });
});

describe('POST /api/dnscontrol/:containerName/:domain/records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertDnsRecord.mockResolvedValue({ success: true, message: 'Created TXT record' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/mailserver/example.com/records')
      .send({ name: '_dmarc.example.com', type: 'TXT', data: 'v=DMARC1' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/mailserver/example.com/records')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ name: '_dmarc.example.com', type: 'TXT', data: 'v=DMARC1' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/mailserver/not_a_domain!/records')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ name: 'host', type: 'TXT', data: 'value' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid.*domain/);
  });

  it('returns 400 when name, type, or data is missing', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/mailserver/example.com/records')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ name: '_spf.example.com', type: 'TXT' }); // missing data

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name, type, and data/i);
  });

  it('admin can upsert a DNS record', async () => {
    const res = await request(app)
      .post('/api/dnscontrol/mailserver/example.com/records')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ name: '_dmarc.example.com', type: 'TXT', data: 'v=DMARC1; p=none' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsertDnsRecord).toHaveBeenCalledWith(
      'mailserver',
      'example.com',
      { name: '_dmarc.example.com', type: 'TXT', data: 'v=DMARC1; p=none' }
    );
  });

  it('returns 500 when upsertDnsRecord throws', async () => {
    mockUpsertDnsRecord.mockRejectedValue(new Error('Provider error'));

    const res = await request(app)
      .post('/api/dnscontrol/mailserver/example.com/records')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ name: 'example.com', type: 'TXT', data: 'v=spf1 -all' });

    expect(res.status).toBe(500);
  });
});

describe('GET /api/domains/:containerName/dkim-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDkimSelector.mockResolvedValue({ success: true, message: 'mail' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/domains/mailserver/dkim-selector');
    expect(res.status).toBe(401);
  });

  it('returns dkim selector for authenticated user', async () => {
    const res = await request(app)
      .get('/api/domains/mailserver/dkim-selector')
      .set('Cookie', [`accessToken=${userToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetDkimSelector).toHaveBeenCalledWith('mailserver', 'mailserver');
  });

  it('returns 500 when getDkimSelector throws', async () => {
    mockGetDkimSelector.mockRejectedValue(new Error('error'));

    const res = await request(app)
      .get('/api/domains/mailserver/dkim-selector')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/domains/:containerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: [{ domain: 'example.com' }],
    });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/domains/mailserver');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/domains/mailserver')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('admin can get all domains', async () => {
    const res = await request(app)
      .get('/api/domains/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetDomains).toHaveBeenCalledWith('mailserver', undefined);
  });

  it('admin can get a specific domain', async () => {
    mockGetDomains.mockResolvedValue({ success: true, message: { domain: 'example.com' } });

    const res = await request(app)
      .get('/api/domains/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockGetDomains).toHaveBeenCalledWith('mailserver', 'example.com');
  });

  it('returns 500 when getDomains throws', async () => {
    mockGetDomains.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/domains/mailserver')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/domains/:containerName/:domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateDB.mockResolvedValue({ success: true, message: 'Updated' });
    mockDbRun.mockReturnValue({ changes: 1 });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/domains/mailserver/example.com')
      .send({ dnsProvider: 'cloudflare' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .patch('/api/domains/mailserver/example.com')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({ dnsProvider: 'cloudflare' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .patch('/api/domains/mailserver/not_a_domain!')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ dnsProvider: 'cloudflare' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid.*domain/);
  });

  it('admin can update a domain', async () => {
    const res = await request(app)
      .patch('/api/domains/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ dnsProvider: 'cloudflare' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpdateDB).toHaveBeenCalledWith(
      'domains',
      'example.com',
      { dnsProvider: 'cloudflare' },
      'mailserver'
    );
  });
});

describe('GET /api/dns/:containerName/:domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsLookup.mockResolvedValue({ success: true, message: { MX: [] } });
    mockGetDomains.mockResolvedValue({ success: true, message: { dkim: 'mail' } });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dns/mailserver/example.com');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/dns/mailserver/example.com')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .get('/api/dns/mailserver/not_a_domain!')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid.*domain/);
  });

  it('admin can perform DNS lookup', async () => {
    const res = await request(app)
      .get('/api/dns/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockDnsLookup).toHaveBeenCalledWith('example.com', 'mail');
  });

  it('falls back to default dkim selector when getDomains fails', async () => {
    mockGetDomains.mockRejectedValue(new Error('not found'));

    const res = await request(app)
      .get('/api/dns/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockDnsLookup).toHaveBeenCalledWith('example.com', 'dkim');
  });
});

describe('POST /api/domains/:containerName/:domain/dkim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateDkim.mockResolvedValue({ success: true, message: 'DKIM key generated' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/domains/mailserver/example.com/dkim')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/domains/mailserver/example.com/dkim')
      .set('Cookie', [`accessToken=${userToken}`])
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .post('/api/domains/mailserver/not_a_domain!/dkim')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid.*domain/);
  });

  it('admin can generate DKIM key', async () => {
    const res = await request(app)
      .post('/api/domains/mailserver/example.com/dkim')
      .set('Cookie', [`accessToken=${adminToken}`])
      .send({ keytype: 'rsa', keysize: '2048', selector: 'mail', force: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGenerateDkim).toHaveBeenCalledWith(
      'mailserver', 'mailserver', 'example.com', 'rsa', '2048', 'mail', false
    );
  });
});

describe('GET /api/dnsbl/:containerName/:domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDnsblCheck.mockResolvedValue({ success: true, message: [] });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dnsbl/mailserver/example.com');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/dnsbl/mailserver/example.com')
      .set('Cookie', [`accessToken=${userToken}`]);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid domain format', async () => {
    const res = await request(app)
      .get('/api/dnsbl/mailserver/not_a_domain!')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ii]nvalid.*domain/);
  });

  it('admin can perform DNSBL check', async () => {
    const res = await request(app)
      .get('/api/dnsbl/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(mockDnsblCheck).toHaveBeenCalledWith('mailserver', 'example.com');
  });

  it('returns 500 when dnsblCheck throws', async () => {
    mockDnsblCheck.mockRejectedValue(new Error('DNS timeout'));

    const res = await request(app)
      .get('/api/dnsbl/mailserver/example.com')
      .set('Cookie', [`accessToken=${adminToken}`]);

    expect(res.status).toBe(500);
  });
});
