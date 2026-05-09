import { describe, it, expect, vi } from 'vitest';

// env.mjs runs side effects at import time (dotenv.config, plus a few
// process.env destructures that throw on missing values). Stub the
// minimum needed *before* env.mjs imports.
vi.hoisted(() => {
  process.env.DMSGUI_VERSION = 'test';
});
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

import { resolveSmtpTlsVerify } from './env.mjs';

describe('resolveSmtpTlsVerify (Sprint 11 — #34)', () => {
  it('explicit "false" overrides everything else', () => {
    expect(
      resolveSmtpTlsVerify({
        SMTP_TLS_VERIFY: 'false',
        SMTP_HOST: 'real.example.com',
      })
    ).toBe(false);
  });

  it('explicit "true" overrides everything else', () => {
    expect(resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'true' })).toBe(true);
  });

  it('explicit override is case-insensitive', () => {
    expect(resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'FALSE' })).toBe(false);
    expect(resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'True' })).toBe(true);
  });

  it('SMTP_HOST set + no override → defaults to true (proper validation)', () => {
    expect(resolveSmtpTlsVerify({ SMTP_HOST: 'smtp.example.com' })).toBe(true);
  });

  it('SMTP_HOST unset + no override → defaults to false (Docker default mailserver)', () => {
    expect(resolveSmtpTlsVerify({})).toBe(false);
  });

  it('SMTP_HOST="" (empty string) is treated as unset → false', () => {
    // process.env values are always strings; empty string means
    // "set to nothing", which from the user's perspective is the
    // same as not setting it.
    expect(resolveSmtpTlsVerify({ SMTP_HOST: '' })).toBe(false);
  });

  it('explicit "false" still wins even when SMTP_HOST is set', () => {
    expect(
      resolveSmtpTlsVerify({
        SMTP_TLS_VERIFY: 'false',
        SMTP_HOST: 'smtp.example.com',
      })
    ).toBe(false);
  });

  it('explicit "true" still wins when SMTP_HOST is unset', () => {
    expect(resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'true' })).toBe(true);
  });

  it('garbage SMTP_TLS_VERIFY value falls through to host-presence default', () => {
    // If someone writes SMTP_TLS_VERIFY=yes by mistake, the expression
    // does not match either explicit value, so we fall through to
    // SMTP_HOST presence. Document the behaviour so it doesn't surprise.
    expect(
      resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'yes', SMTP_HOST: 'x' })
    ).toBe(true);
    expect(resolveSmtpTlsVerify({ SMTP_TLS_VERIFY: 'yes' })).toBe(false);
  });
});
