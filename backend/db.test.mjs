import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';

const testSecret = crypto.randomBytes(32).toString('hex');

// Mock env before importing db.mjs
vi.mock('./env.mjs', () => {
  const crypto = require('node:crypto');
  const secret = testSecret;
  return {
    env: {
      AES_SECRET: secret,
      AES_ALGO: 'aes-256-cbc',
      AES_HASH: 'sha512',
      AES_KEY: crypto
        .createHash('sha512')
        .update(secret)
        .digest()
        .subarray(0, 32),
      IV_LEN: 16,
      HASH_LEN: 64,
      DATABASE: ':memory:',
      DMSGUI_VERSION: '1.0.0',
      isMutable: 1,
      isImmutable: 0,
      DMS_CONFIG_PATH: '/tmp',
      DKIM_SELECTOR_DEFAULT: 'mail',
      DKIM_KEYTYPE_DEFAULT: 'rsa',
      DKIM_KEYSIZE_DEFAULT: 2048,
    },
    plugins: {},
  };
});

// Mock backend.mjs logging
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  execSetup: vi.fn(),
  execCommand: vi.fn(),
  formatDMSError: vi.fn(),
}));

// Mock settings.mjs
vi.mock('./settings.mjs', () => ({
  getSettings: vi.fn(() => ({ success: false })),
}));

const { encrypt, decrypt, getTargetDict } = await import('./db.mjs');

describe('encrypt / decrypt roundtrip', () => {
  it('roundtrips a simple string', () => {
    const plaintext = 'hello world';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('roundtrips an empty string', () => {
    const plaintext = '';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('roundtrips unicode text', () => {
    const plaintext = 'unicode test 日本語';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('roundtrips JSON data', () => {
    const obj = { token: 'abc123', secret: 's3cr3t' };
    const plaintext = JSON.stringify(obj);
    const ciphertext = encrypt(plaintext);
    const result = JSON.parse(decrypt(ciphertext));
    expect(result).toEqual(obj);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'deterministic?';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('test');
    // Flip a character in the ciphertext portion (after the IV hex)
    const tampered = ciphertext.slice(0, 34) + 'ff' + ciphertext.slice(36);
    expect(() => decrypt(tampered)).toThrow();
  });

  it('roundtrips a long string (API key length)', () => {
    const plaintext = 'dms-d6657c97-abcd-1234-5678-3e3d43478f41';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('writes the GCM format prefix on every new encryption', () => {
    const ct = encrypt('marker');
    expect(ct.startsWith('g1:')).toBe(true);
    // Format is g1:iv_hex:tag_hex:cipher_hex
    const parts = ct.slice(3).split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV as hex
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag as hex
  });

  it('reads legacy CBC ciphertext written by the pre-2.2.0 format', () => {
    // Construct a CBC ciphertext manually using the same AES key, in the
    // exact format the old encrypt() produced: iv_hex || cipher_hex (concat).
    const key = crypto
      .createHash('sha512')
      .update(testSecret)
      .digest()
      .subarray(0, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let cbcCipher = cipher.update('legacy-payload', 'utf-8', 'hex');
    cbcCipher += cipher.final('hex');
    const legacyCiphertext = iv.toString('hex') + cbcCipher;

    expect(legacyCiphertext.startsWith('g1:')).toBe(false);
    expect(decrypt(legacyCiphertext)).toBe('legacy-payload');
  });

  it('passes through null/undefined unchanged', () => {
    expect(decrypt(null)).toBe(null);
    expect(decrypt(undefined)).toBe(undefined);
  });
});

describe('getTargetDict — protocol allowlist (SSRF defense)', () => {
  // Regression coverage for code-scanning alert #68. The user-supplied
  // settings path feeds straight into the URL fetch() hits; without an
  // allowlist, an admin could supply protocol='file' / 'gopher' /
  // anything else to reach non-HTTP resources via the underlying
  // fetch() call. Reject upfront with the failure shape the existing
  // classifyMissingAuthTargetDict consumer already handles.
  const validSettings = (override = {}) => [
    { name: 'protocol', value: override.protocol ?? 'http' },
    { name: 'containerName', value: 'mailserver' },
    { name: 'DMS_API_PORT', value: '8888' },
    { name: 'DMS_API_KEY', value: 'k' },
    { name: 'setupPath', value: '/usr/local/bin/setup' },
    { name: 'timeout', value: '4' },
  ];

  it('accepts http', () => {
    const r = getTargetDict(
      'mailserver',
      'dms',
      validSettings({ protocol: 'http' })
    );
    expect(r.protocol).toBe('http');
    expect(r.host).toBe('mailserver');
  });

  it('accepts https', () => {
    const r = getTargetDict(
      'mailserver',
      'dms',
      validSettings({ protocol: 'https' })
    );
    expect(r.protocol).toBe('https');
  });

  for (const bad of [
    'file',
    'gopher',
    'ftp',
    'javascript',
    'data',
    '',
    'HTTP',
  ]) {
    it(`rejects protocol '${bad}'`, () => {
      const r = getTargetDict(
        'mailserver',
        'dms',
        validSettings({ protocol: bad })
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/protocol must be one of/);
    });
  }
});

describe('getTargetDict — host allowlist (SSRF defense, CodeQL #68)', () => {
  // Hostnames flow into fetch() as `${protocol}://${host}:${port}`.
  // The regex sanitizer in getTargetDict is the structural barrier
  // CodeQL recognises; a host failing it never reaches the URL.
  const settingsWithHost = (host) => [
    { name: 'protocol', value: 'http' },
    { name: 'containerName', value: host },
    { name: 'DMS_API_PORT', value: '8888' },
    { name: 'DMS_API_KEY', value: 'k' },
    { name: 'setupPath', value: '/usr/local/bin/setup' },
    { name: 'timeout', value: '4' },
  ];

  for (const ok of [
    'mailserver',
    'mail.example.com',
    'dms-gui',
    'dms_gui',
    'dms-gui_mailserver_1',
    'a.b.c.d.example.com',
    '1mailserver', // leading digit is fine if the hostname has letters
    '2mail.example.com', // ditto
  ]) {
    it(`accepts hostname '${ok}'`, () => {
      const r = getTargetDict('mailserver', 'dms', settingsWithHost(ok));
      expect(r.host).toBe(ok);
      expect(r.success).toBeUndefined(); // no failure shape
    });
  }

  it('lowercases the canonical hostname comparison so MIXED-case input still passes', () => {
    // The URL parser canonicalises hostnames to lowercase. Our
    // sanitizer compares against `s.toLowerCase()` so an input like
    // `MAIL.EXAMPLE.COM` survives the canonicalisation check.
    const r = getTargetDict(
      'mailserver',
      'dms',
      settingsWithHost('MAIL.EXAMPLE.COM')
    );
    expect(r.host).toBe('MAIL.EXAMPLE.COM');
  });

  for (const bad of [
    '127.0.0.1', // loopback (canonical 4-octet)
    '169.254.169.254', // AWS metadata (canonical 4-octet)
    '10.0.0.5', // private LAN
    '192.168.1.1', // private LAN
    '0.0.0.0',
    '999.999.999.999', // IPv4-shaped but out of routable range
    '[::1]', // IPv6 loopback
    'mailserver:8888/path', // URL metacharacters
    'mailserver/foo',
    'foo bar', // whitespace
    'foo@bar', // @ metachar
    '?internal=true',
    '', // empty
    // WHATWG IPv4 shorthand: the URL parser canonicalises these to
    // routable IPs before fetch() sees them. Without the canonical-
    // hostname check, they'd slip through as "alphanumeric hosts"
    // and immediately route to loopback / LAN / metadata.
    '127.1', // 2-part shorthand for 127.0.0.1
    '127.0.1', // 3-part shorthand for 127.0.0.1
    '2130706433', // single-integer form of 127.0.0.1
    '1234', // single-integer form of 0.0.4.210 (Node canonicalises)
    '12.34', // 2-part shorthand
    '1.2.3', // 3-part shorthand
    '1.2.3.4.5', // 5-part: URL parser may treat unevenly
  ]) {
    it(`rejects host ${JSON.stringify(bad)}`, () => {
      const r = getTargetDict('mailserver', 'dms', settingsWithHost(bad));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/host must be a valid hostname/);
    });
  }
});

describe('getTargetDict — port validation', () => {
  const settingsWithPort = (port) => [
    { name: 'protocol', value: 'http' },
    { name: 'containerName', value: 'mailserver' },
    { name: 'DMS_API_PORT', value: port },
    { name: 'DMS_API_KEY', value: 'k' },
    { name: 'setupPath', value: '/usr/local/bin/setup' },
    { name: 'timeout', value: '4' },
  ];

  it('accepts a typical port string', () => {
    const r = getTargetDict('mailserver', 'dms', settingsWithPort('8888'));
    expect(r.port).toBe('8888');
  });

  it('accepts the high end of the range', () => {
    const r = getTargetDict('mailserver', 'dms', settingsWithPort('65535'));
    expect(r.port).toBe('65535');
  });

  it('accepts leading zeros (Node URL parser canonicalises them anyway)', () => {
    // Backwards-compat with older stored settings that might carry
    // leading zeros (`080`). The range check still rejects out-of-
    // range values regardless of zero-padding.
    const r = getTargetDict('mailserver', 'dms', settingsWithPort('080'));
    expect(r.port).toBe('080');
  });

  for (const bad of [
    '0', // value out of range (range check, not regex)
    '65536', // value out of range
    '99999', // value out of range
    '-1', // negative — rejected by digits-only regex
    '8888.0', // dot — rejected by digits-only regex
    'abc', // non-numeric — rejected by digits-only regex
    '', // empty — rejected by digits-only regex
    ' 8888', // leading whitespace — rejected by digits-only regex
    '99999999', // > 7 digits — rejected by length cap
  ]) {
    it(`rejects port ${JSON.stringify(bad)}`, () => {
      const r = getTargetDict('mailserver', 'dms', settingsWithPort(bad));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/port must be an integer/);
    });
  }
});
