import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  infoLog: vi.fn(),
}));

vi.mock('./env.mjs', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret',
    NODE_ENV: 'test',
  },
  plugins: {
    dnscontrol: {
      cloudflare: { apitoken: '' },
      domeneshop: { token: '', secret: '' },
      digitalocean: { apitoken: '' },
      hetzner: { apitoken: '' },
    },
  },
}));

const mockGetSetting = vi.fn();
const mockGetDomains = vi.fn();

vi.mock('./settings.mjs', () => ({
  getSetting: (...args) => mockGetSetting(...args),
  getDomains: (...args) => mockGetDomains(...args),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { upsertDnsRecord } from './dnsProviders.mjs';

// Helper: build a minimal ok/fail fetch response
const fetchOk = (body) =>
  Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
const fetchErr = (status, text = 'Error') =>
  Promise.resolve({ ok: false, status, statusText: text, json: () => Promise.resolve({ errors: [{ message: text }] }), text: () => Promise.resolve(text) });

describe('upsertDnsRecord — missing provider assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no DNS provider is assigned to domain', async () => {
    mockGetDomains.mockResolvedValue({ success: true, message: { domain: 'example.com' } });

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 -all',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No DNS provider/i);
  });

  it('throws when provider credentials profile not found', async () => {
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'my-cloudflare' },
    });
    mockGetSetting.mockResolvedValue({ success: false });

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/profile.*not found/i);
  });

  it('throws when provider credentials have no type field', async () => {
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'my-provider' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ apitoken: 'tok' }), // no type
    });

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/no type/i);
  });

  it('throws for unsupported provider type', async () => {
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'my-provider' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'unknownprovider', apitoken: 'tok' }),
    });

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/not supported/i);
  });
});

describe('upsertDnsRecord — Cloudflare provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'cf-profile' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'cloudflare', apitoken: 'cf-token' }),
    });
  });

  it('creates a new TXT record when none exists', async () => {
    // resolveDomain: find zone
    mockFetch
      .mockResolvedValueOnce(fetchOk({ result: [{ id: 'zone-1', name: 'example.com' }] }))
      // findTxtRecord: no existing records
      .mockResolvedValueOnce(fetchOk({ result: [] }))
      // create record
      .mockResolvedValueOnce(fetchOk({ result: { id: 'rec-1' } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 mx -all',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Created/i);
  });

  it('updates an existing TXT record', async () => {
    mockFetch
      // resolveDomain
      .mockResolvedValueOnce(fetchOk({ result: [{ id: 'zone-1', name: 'example.com' }] }))
      // findTxtRecord: existing record found
      .mockResolvedValueOnce(fetchOk({ result: [{ id: 'rec-1', content: 'v=spf1 -all' }] }))
      // update record
      .mockResolvedValueOnce(fetchOk({ result: { id: 'rec-1' } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 mx -all',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Updated/i);
  });

  it('throws on Cloudflare auth failure (401)', async () => {
    mockFetch.mockResolvedValueOnce(fetchErr(401, 'Unauthorized'));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/authentication failed/i);
  });

  it('throws when domain not found at Cloudflare', async () => {
    // All zone searches return empty result (strip labels until single TLD)
    mockFetch.mockResolvedValue(fetchOk({ result: [] }));

    await expect(
      upsertDnsRecord('mailserver', 'sub.example.com', {
        name: 'sub.example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/not found at Cloudflare/i);
  });
});

describe('upsertDnsRecord — Domeneshop provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'ds-profile' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'domeneshop', token: 'tok', secret: 'sec' }),
    });
  });

  it('creates a new TXT record', async () => {
    mockFetch
      // resolveDomain: list domains
      .mockResolvedValueOnce(fetchOk([{ id: 100, domain: 'example.com' }]))
      // listRecords: no matching TXT record
      .mockResolvedValueOnce(fetchOk([]))
      // create record
      .mockResolvedValueOnce(fetchOk({ id: 200 }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: '_dmarc.example.com',
      type: 'TXT',
      data: 'v=DMARC1; p=none',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Created/i);
  });

  it('updates an existing TXT record', async () => {
    mockFetch
      // resolveDomain
      .mockResolvedValueOnce(fetchOk([{ id: 100, domain: 'example.com' }]))
      // listRecords: existing DMARC record
      .mockResolvedValueOnce(fetchOk([{ id: 50, type: 'TXT', host: '_dmarc', data: 'v=DMARC1; p=none' }]))
      // update
      .mockResolvedValueOnce(fetchOk({}));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: '_dmarc.example.com',
      type: 'TXT',
      data: 'v=DMARC1; p=reject',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Updated/i);
  });

  it('throws on Domeneshop auth failure (401)', async () => {
    mockFetch.mockResolvedValueOnce(fetchErr(401, 'Unauthorized'));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/authentication failed/i);
  });

  it('throws when domain not found at Domeneshop', async () => {
    mockFetch.mockResolvedValueOnce(fetchOk([]));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/not found at Domeneshop/i);
  });
});

describe('upsertDnsRecord — DigitalOcean provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'do-profile' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'digitalocean', apitoken: 'do-token' }),
    });
  });

  it('creates a new TXT record', async () => {
    mockFetch
      // resolveDomain
      .mockResolvedValueOnce(fetchOk({ domains: [{ name: 'example.com' }] }))
      // findTxtRecord
      .mockResolvedValueOnce(fetchOk({ domain_records: [] }))
      // create
      .mockResolvedValueOnce(fetchOk({ domain_record: { id: 1 } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 -all',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Created/i);
  });

  it('updates an existing TXT record', async () => {
    mockFetch
      // resolveDomain
      .mockResolvedValueOnce(fetchOk({ domains: [{ name: 'example.com' }] }))
      // findTxtRecord: existing
      .mockResolvedValueOnce(fetchOk({ domain_records: [{ id: 5, name: '@', data: 'v=spf1 -all' }] }))
      // update
      .mockResolvedValueOnce(fetchOk({ domain_record: { id: 5 } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 mx -all',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Updated/i);
  });

  it('throws on DigitalOcean auth failure (401)', async () => {
    mockFetch.mockResolvedValueOnce(fetchErr(401, 'Unauthorized'));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/authentication failed/i);
  });

  it('throws when domain not found at DigitalOcean', async () => {
    mockFetch.mockResolvedValueOnce(fetchOk({ domains: [] }));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/not found at DigitalOcean/i);
  });
});

describe('upsertDnsRecord — Hetzner provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'hz-profile' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'hetzner', apitoken: 'hz-token' }),
    });
  });

  it('creates a new TXT record', async () => {
    mockFetch
      // resolveDomain: list zones
      .mockResolvedValueOnce(fetchOk({ zones: [{ id: 'z1', name: 'example.com' }] }))
      // findTxtRecord: no existing records
      .mockResolvedValueOnce(fetchOk({ records: [] }))
      // create record
      .mockResolvedValueOnce(fetchOk({ record: { id: 'r1' } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'mail._domainkey.example.com',
      type: 'TXT',
      data: 'v=DKIM1; k=rsa; p=...',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Created/i);
  });

  it('updates an existing TXT record', async () => {
    mockFetch
      // resolveDomain
      .mockResolvedValueOnce(fetchOk({ zones: [{ id: 'z1', name: 'example.com' }] }))
      // findTxtRecord: existing DKIM record
      .mockResolvedValueOnce(fetchOk({ records: [{ id: 'r1', type: 'TXT', name: 'mail._domainkey', value: 'v=DKIM1; k=rsa; p=old' }] }))
      // update
      .mockResolvedValueOnce(fetchOk({ record: { id: 'r1' } }));

    const result = await upsertDnsRecord('mailserver', 'example.com', {
      name: 'mail._domainkey.example.com',
      type: 'TXT',
      data: 'v=DKIM1; k=rsa; p=new',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Updated/i);
  });

  it('throws on Hetzner auth failure (401)', async () => {
    mockFetch.mockResolvedValueOnce(fetchErr(401, 'Unauthorized'));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/authentication failed/i);
  });

  it('throws when zone not found at Hetzner', async () => {
    mockFetch.mockResolvedValueOnce(fetchOk({ zones: [] }));

    await expect(
      upsertDnsRecord('mailserver', 'example.com', {
        name: 'example.com',
        type: 'TXT',
        data: 'v=spf1 -all',
      })
    ).rejects.toThrow(/not found at Hetzner/i);
  });
});

describe('upsertDnsRecord — contentPrefix logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDomains.mockResolvedValue({
      success: true,
      message: { dnsProvider: 'cf-profile' },
    });
    mockGetSetting.mockResolvedValue({
      success: true,
      message: JSON.stringify({ type: 'cloudflare', apitoken: 'tok' }),
    });
  });

  it('uses "v=spf1" prefix when data starts with v=spf1', async () => {
    // Cloudflare: resolveDomain, findTxtRecord, create
    mockFetch
      .mockResolvedValueOnce(fetchOk({ result: [{ id: 'z1', name: 'example.com' }] }))
      .mockResolvedValueOnce(fetchOk({ result: [] }))
      .mockResolvedValueOnce(fetchOk({ result: {} }));

    await upsertDnsRecord('mailserver', 'example.com', {
      name: 'example.com',
      type: 'TXT',
      data: 'v=spf1 mx -all',
    });

    // The findTxtRecord call (2nd fetch) should have used the ?name= URL — content filtering is done client-side
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('uses "v=DMARC1" prefix when data starts with v=DMARC1', async () => {
    mockFetch
      .mockResolvedValueOnce(fetchOk({ result: [{ id: 'z1', name: 'example.com' }] }))
      .mockResolvedValueOnce(fetchOk({ result: [] }))
      .mockResolvedValueOnce(fetchOk({ result: {} }));

    await upsertDnsRecord('mailserver', 'example.com', {
      name: '_dmarc.example.com',
      type: 'TXT',
      data: 'v=DMARC1; p=none',
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
