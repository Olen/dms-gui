import { describe, it, expect, vi } from 'vitest';

// env.mjs runs side effects at import time (process.env destructures
// that throw on missing values). Stub the minimum needed *before*
// env.mjs imports. Production env-file loading is handled by Node's
// --env-file flag at process startup, not at module-import time.
vi.hoisted(() => {
  process.env.DMSGUI_VERSION = 'test';
});

import { resolveSmtpTlsVerify, mailserverRESTAPI, env } from './env.mjs';
import { REST_API_MANIFEST } from './restApiManifest.mjs';

describe('resolveSmtpTlsVerify', () => {
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

describe('mailserverRESTAPI.dms.manifest', () => {
  it('exposes a manifest config entry alongside api and cron', () => {
    expect(mailserverRESTAPI.dms).toHaveProperty('manifest');
    expect(mailserverRESTAPI.dms.manifest).toMatchObject({
      desc: expect.any(String),
      path: expect.any(String),
      content: expect.any(String),
    });
  });

  it('manifest content is valid JSON matching REST_API_MANIFEST', () => {
    const parsed = JSON.parse(mailserverRESTAPI.dms.manifest.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(REST_API_MANIFEST);
  });

  it('manifest path is exactly DMSGUI_CONFIG_PATH + filename', () => {
    // Asserts the contract end-to-end: prefix derives from env (not a
    // hardcoded literal that drifts) and filename is the one rest-api.py
    // reads at startup.
    expect(mailserverRESTAPI.dms.manifest.path).toBe(
      env.DMSGUI_CONFIG_PATH + '/rest-api-manifest.json'
    );
  });
});

describe('rest-api.py interpreter wiring', () => {
  const py = mailserverRESTAPI.dms.api.content;

  // ---- Manifest loading at startup ----
  it('loads the manifest from MANIFEST_PATH at module import', () => {
    expect(py).toContain('MANIFEST_PATH');
    expect(py).toContain('def load_manifest(');
    expect(py).toContain('/rest-api-manifest.json');
    expect(py).toContain('raise ValueError');
  });

  // ---- Five validator types from the spec ----
  it('implements all declared validator types', () => {
    expect(py).toContain("'enum'");
    expect(py).toContain("'regex'");
    expect(py).toContain("'int'");
    expect(py).toContain("'string'");
    expect(py).toContain("'optional'");
  });

  it('uses re.fullmatch for regex validators (not re.match)', () => {
    expect(py).toContain('re.fullmatch');
    expect(py).not.toContain('re.match(');
  });

  // ---- Token-level substitution ----
  it('does token-level template substitution, not string interpolation', () => {
    expect(py).toMatch(/PLACEHOLDER\s*=\s*re\.compile/);
    expect(py).toContain('def substitute(');
  });

  // ---- shell=False everywhere ----
  it('runs subprocess.Popen with shell=False', () => {
    expect(py).toContain('subprocess.Popen');
    expect(py).toContain('shell=False');
    expect(py).not.toContain('shell=True');
  });

  // ---- do_POST is action-only (legacy {command:} branch removed) ----
  it('only accepts the action protocol (no legacy command branch)', () => {
    expect(py).toContain("json_data.get('action')");
    expect(py).not.toContain("json_data.get('command')");
    // The 400 path triggers when 'action' is missing, replacing the
    // pre-removal "no action or command was passed" branch.
    expect(py).toContain("missing 'action' field");
  });

  // ---- Unknown action → 403, not 200 ----
  it('rejects unknown action ids with HTTP 403', () => {
    const idx = py.indexOf('unknown action');
    expect(idx).toBeGreaterThan(0);
    expect(py.slice(Math.max(0, idx - 200), idx + 300)).toMatch(/403/);
  });

  // ---- Redirect target safety ----
  it("rejects redirect targets that aren't absolute or contain '..'", () => {
    expect(py).toMatch(/not target\.startswith\('\/'\)/);
    expect(py).toMatch(/'\.\.' in target/);
  });
});
