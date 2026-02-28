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

const { encrypt, decrypt } = await import('./db.mjs');

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
});
