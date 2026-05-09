import { describe, it, expect, vi } from 'vitest';

// env.mjs runs side effects at import time (dotenv.config, plus a few
// process.env destructures that throw on missing values). Stub the
// minimum needed *before* env.mjs imports.
vi.hoisted(() => {
  process.env.DMSGUI_VERSION = 'test';
});
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

import {
  resolveSmtpTlsVerify,
  REST_API_DEFAULT_ALLOWED_BINS,
  mailserverRESTAPI,
} from './env.mjs';

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

describe('REST_API_DEFAULT_ALLOWED_BINS (Sprint 16 — #58)', () => {
  it('contains every binary the backend currently invokes', () => {
    // This list is the audited surface from a sweep of backend/*.mjs.
    // If a future change adds a new binary, the audit must be updated
    // alongside the allowlist — these assertions force that discipline.
    const required = [
      'setup',
      'doveadm',
      'doveconf',
      'dovecot',
      'postfix',
      'ps',
      'df',
      'top',
      'tail',
      'grep',
      'cat',
      'env',
      'echo',
      'mv',
      'mkdir',
      'cp',
      'chown',
      'awk',
      'base64',
      'redis-cli',
    ];
    for (const bin of required) {
      expect(REST_API_DEFAULT_ALLOWED_BINS).toContain(bin);
    }
  });

  it('does not include shells or general-purpose interpreters', () => {
    // The point of the allowlist is to deny "anything goes" execution
    // even with a valid API key. Shells and interpreters defeat that
    // purpose because they re-introduce arbitrary command execution.
    const forbidden = [
      'sh',
      'bash',
      'zsh',
      'dash',
      'ash',
      'python',
      'python3',
      'perl',
      'ruby',
      'node',
    ];
    for (const bin of forbidden) {
      expect(REST_API_DEFAULT_ALLOWED_BINS).not.toContain(bin);
    }
  });

  it('does not include network/exfiltration tools', () => {
    // Even read-only network tools shouldn't be in the default surface
    // — they convert "command execution on mailserver" into "outbound
    // egress on mailserver", which crosses a different security boundary.
    const forbidden = ['curl', 'wget', 'nc', 'ncat', 'socat', 'ssh', 'scp'];
    for (const bin of forbidden) {
      expect(REST_API_DEFAULT_ALLOWED_BINS).not.toContain(bin);
    }
  });

  it('has no duplicate entries', () => {
    expect(REST_API_DEFAULT_ALLOWED_BINS.length).toBe(
      new Set(REST_API_DEFAULT_ALLOWED_BINS).size
    );
  });
});

describe('rest-api.py allowlist wiring (Sprint 16 — #58)', () => {
  const py = mailserverRESTAPI.dms.api.content;

  it('renders the default allowlist as a Python set literal', () => {
    // Spot-check: the JS array got interpolated into the Python set.
    // Both 'setup' and 'doveadm' must appear quoted with surrounding
    // braces so the rendered Python is a valid set literal, not a
    // string concatenation.
    expect(py).toContain("DMS_API_DEFAULT_ALLOWED_BINS = {'setup'");
    expect(py).toContain("'doveadm'");
    expect(py).toContain("'redis-cli'}");
  });

  it('reads DMS_API_ALLOWED_BINS from the environment as an override', () => {
    expect(py).toContain("os.environ.get('DMS_API_ALLOWED_BINS', '')");
  });

  it('rejects any pipeline stage whose binary is not in the allowlist', () => {
    // The guard must be present and must run before subprocess.Popen.
    // We assert both: (a) the rejection branch exists, (b) the loop
    // iterates over `stages` so every stage is checked (not just the
    // first), and (c) the guard sits above the Popen loop.
    expect(py).toContain('not in DMS_API_ALLOWED_BINS');
    expect(py).toContain('os.path.basename(stage[0])');
    const guardIdx = py.indexOf('not in DMS_API_ALLOWED_BINS');
    const popenIdx = py.indexOf('subprocess.Popen(stage');
    expect(guardIdx).toBeGreaterThan(0);
    expect(popenIdx).toBeGreaterThan(guardIdx); // guard must precede Popen
  });
});
