import { describe, it, expect, vi } from 'vitest';
import { isValidCorsOrigin, parseCorsOrigins } from './corsConfig.mjs';

describe('isValidCorsOrigin', () => {
  // Regression coverage for code-scanning alert #1
  // (js/cors-permissive-configuration). The validator is the choke
  // point that turns the operator-supplied CORS_ORIGINS env value
  // into an allowlist; a misconfigured `*` or trailing path used to
  // flow straight to the cors middleware unfiltered.

  for (const ok of [
    'http://example.com',
    'https://example.com',
    'http://localhost:3000',
    'https://app.example.com:8443',
    'http://10.0.0.5',
    'http://[::1]:8080',
  ]) {
    it(`accepts ${ok}`, () => {
      expect(isValidCorsOrigin(ok)).toBe(true);
    });
  }

  for (const bad of [
    '*',
    'example.com', // no scheme
    'ftp://example.com', // disallowed scheme
    'http://example.com/path', // trailing path
    'http://example.com/', // trailing slash counts as path
    'https://', // empty host
    'http:// example.com', // whitespace in host
    'https://user@example.com', // userinfo not allowed
    'https://user:pass@example.com', // userinfo not allowed
    '',
    '   ',
    null,
    undefined,
    42,
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(isValidCorsOrigin(bad)).toBe(false);
    });
  }
});

describe('parseCorsOrigins', () => {
  it('returns null for unset env', () => {
    expect(parseCorsOrigins(undefined)).toBe(null);
    expect(parseCorsOrigins('')).toBe(null);
  });

  it('parses a single valid origin', () => {
    expect(parseCorsOrigins('https://app.example.com')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('parses comma-separated origins, trimming whitespace', () => {
    expect(
      parseCorsOrigins('https://a.example.com, http://localhost:3000 ,')
    ).toEqual(['https://a.example.com', 'http://localhost:3000']);
  });

  it('drops wildcard `*` entries and logs them via the warn callback', () => {
    const warn = vi.fn();
    const result = parseCorsOrigins('*,https://app.example.com', warn);
    expect(result).toEqual(['https://app.example.com']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropping invalid CORS_ORIGINS entry: *')
    );
  });

  it('drops entries with trailing paths', () => {
    expect(
      parseCorsOrigins('https://app.example.com/foo,https://other.example.com')
    ).toEqual(['https://other.example.com']);
  });

  it('returns null when every entry is invalid (caller falls back to same-origin)', () => {
    expect(parseCorsOrigins('*,foo,bar')).toBe(null);
  });
});
