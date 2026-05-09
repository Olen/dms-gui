import { describe, it, expect, vi } from 'vitest';

// Light mocks for the rest of passwordReset.mjs's dependency graph so
// importing the module doesn't trigger any side effects. We only test
// the buildSmtpTransportConfig pure helper here.
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn() },
}));
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  infoLog: vi.fn(),
}));
vi.mock('./db.mjs', () => ({
  changePassword: vi.fn(),
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  // Match the real shape: passwordReset.mjs reads sql.password_resets.*
  // (insert.token, select.{countRecent,byTokenHash}, update.markUsed).
  // These tests don't exercise those paths but using the right key
  // prevents a mock-vs-real drift if a future test does.
  sql: {
    password_resets: {
      insert: { token: '' },
      select: { countRecent: '', byTokenHash: '' },
      update: { markUsed: '' },
    },
  },
}));
vi.mock('./logins.mjs', () => ({ getLogin: vi.fn() }));
vi.mock('./env.mjs', () => ({
  env: { SMTP_HOST: 'mailserver', SMTP_PORT: 25, SMTP_TLS_VERIFY: true },
}));

import { buildSmtpTransportConfig } from './passwordReset.mjs';

describe('buildSmtpTransportConfig — TLS hardening (#34)', () => {
  it('always sets requireTLS:true so an attacker cannot strip STARTTLS', () => {
    const cfg = buildSmtpTransportConfig({
      SMTP_HOST: 'mailserver',
      SMTP_PORT: 25,
      SMTP_TLS_VERIFY: true,
    });
    expect(cfg.requireTLS).toBe(true);
  });

  it('passes SMTP_TLS_VERIFY=true through to tls.rejectUnauthorized (default)', () => {
    const cfg = buildSmtpTransportConfig({
      SMTP_HOST: 'mailserver',
      SMTP_PORT: 25,
      SMTP_TLS_VERIFY: true,
    });
    expect(cfg.tls).toEqual({ rejectUnauthorized: true });
  });

  it('honors SMTP_TLS_VERIFY=false (opt-out for self-signed Docker setups)', () => {
    const cfg = buildSmtpTransportConfig({
      SMTP_HOST: 'mailserver',
      SMTP_PORT: 25,
      SMTP_TLS_VERIFY: false,
    });
    expect(cfg.tls).toEqual({ rejectUnauthorized: false });
    // Crucially, requireTLS stays true even when verification is off:
    // we won't fall back to plaintext, just to a self-signed peer.
    expect(cfg.requireTLS).toBe(true);
  });

  it('passes host and port through unchanged', () => {
    const cfg = buildSmtpTransportConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_TLS_VERIFY: true,
    });
    expect(cfg.host).toBe('smtp.example.com');
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false); // STARTTLS upgrade, not implicit TLS
  });
});
