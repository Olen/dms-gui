import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  execAction: vi.fn(),
}));

vi.mock('./db.mjs', () => ({
  getTargetDict: vi.fn(() => ({
    host: 'localhost',
    timeout: 10,
    setupPath: '/usr/local/bin/setup',
  })),
}));

vi.mock('./env.mjs', () => ({
  env: { isDEMO: false },
}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

import {
  _test,
  getSieveRules,
  saveSieveRules,
  deleteSieveRules,
} from './sieve.mjs';
const { generateSieveScript, parseSieveScript, defaultRules } = _test;
import { execAction } from './backend.mjs';
import { getTargetDict } from './db.mjs';

describe('generateSieveScript', () => {
  it('generates minimal script when all rules are disabled', () => {
    const rules = defaultRules();
    const script = generateSieveScript(rules);

    expect(script).toContain('# dms-gui:forward:begin');
    expect(script).toContain('# dms-gui:forward:end');
    expect(script).toContain('# dms-gui:vacation:begin');
    expect(script).toContain('# dms-gui:vacation:end');
    expect(script).toContain('# dms-gui:block:begin');
    expect(script).toContain('# dms-gui:block:end');
    expect(script).not.toContain('require');
    expect(script).not.toContain('redirect');
    expect(script).not.toMatch(/^vacation /m);
    expect(script).not.toMatch(/^if address/m);
  });

  it('generates forward with keepCopy', () => {
    const rules = defaultRules();
    rules.forward = {
      enabled: true,
      address: 'other@example.com',
      keepCopy: true,
    };
    const script = generateSieveScript(rules);

    expect(script).toContain('require ["copy"]');
    expect(script).toContain('redirect :copy "other@example.com";');
    expect(script).toContain('# dms-gui:forward:address=other@example.com');
    expect(script).toContain('# dms-gui:forward:keepCopy=true');
  });

  it('generates forward without keepCopy', () => {
    const rules = defaultRules();
    rules.forward = {
      enabled: true,
      address: 'other@example.com',
      keepCopy: false,
    };
    const script = generateSieveScript(rules);

    expect(script).not.toContain('require ["copy"]');
    expect(script).toContain('redirect "other@example.com";');
    expect(script).not.toContain(':copy');
  });

  it('generates vacation auto-reply', () => {
    const rules = defaultRules();
    rules.vacation = {
      enabled: true,
      subject: 'Away',
      message: 'I am on vacation.',
      days: 5,
    };
    const script = generateSieveScript(rules);

    expect(script).toContain('require ["vacation"]');
    expect(script).toContain(
      'vacation :days 5 :subject "Away" "I am on vacation.";'
    );
  });

  it('generates vacation without subject', () => {
    const rules = defaultRules();
    rules.vacation = {
      enabled: true,
      subject: '',
      message: 'Gone fishing.',
      days: 14,
    };
    const script = generateSieveScript(rules);

    expect(script).toContain('vacation :days 14 "Gone fishing.";');
    expect(script).not.toContain(':subject');
  });

  it('generates block senders', () => {
    const rules = defaultRules();
    rules.block = {
      enabled: true,
      addresses: ['spam@bad.com', 'junk@worse.com'],
    };
    const script = generateSieveScript(rules);

    expect(script).toContain('require ["reject"]');
    expect(script).toContain(
      'if address :is "from" ["spam@bad.com", "junk@worse.com"] { reject "Blocked"; }'
    );
  });

  it('generates all rules enabled with combined requires', () => {
    const rules = {
      forward: { enabled: true, address: 'fwd@test.com', keepCopy: true },
      vacation: {
        enabled: true,
        subject: 'OOO',
        message: 'Out of office.',
        days: 3,
      },
      block: { enabled: true, addresses: ['bad@evil.com'] },
    };
    const script = generateSieveScript(rules);

    expect(script).toContain('require ["copy", "reject", "vacation"]');
    expect(script).toContain('redirect :copy "fwd@test.com";');
    expect(script).toContain(
      'vacation :days 3 :subject "OOO" "Out of office.";'
    );
    expect(script).toContain(
      'if address :is "from" ["bad@evil.com"] { reject "Blocked"; }'
    );
  });

  it('does not generate sieve actions when enabled but address/message empty', () => {
    const rules = {
      forward: { enabled: true, address: '', keepCopy: true },
      vacation: { enabled: true, subject: 'OOO', message: '', days: 7 },
      block: { enabled: true, addresses: [] },
    };
    const script = generateSieveScript(rules);

    expect(script).not.toContain('require');
    expect(script).not.toContain('redirect');
    expect(script).not.toContain('vacation :days');
    expect(script).not.toContain('reject');
  });
});

describe('parseSieveScript', () => {
  it('returns null for scripts without dms-gui markers', () => {
    const script =
      'require "fileinto";\nif header :contains "X-Spam" "Yes" { fileinto "Junk"; }';
    expect(parseSieveScript(script)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseSieveScript('')).toBeNull();
    expect(parseSieveScript(null)).toBeNull();
    expect(parseSieveScript(undefined)).toBeNull();
  });

  it('parses forward rule', () => {
    const script = [
      '# dms-gui:forward:begin',
      '# dms-gui:forward:enabled=true',
      '# dms-gui:forward:address=user@test.com',
      '# dms-gui:forward:keepCopy=true',
      'redirect :copy "user@test.com";',
      '# dms-gui:forward:end',
      '# dms-gui:vacation:begin',
      '# dms-gui:vacation:enabled=false',
      '# dms-gui:vacation:days=7',
      '# dms-gui:vacation:end',
      '# dms-gui:block:begin',
      '# dms-gui:block:enabled=false',
      '# dms-gui:block:end',
    ].join('\n');

    const rules = parseSieveScript(script);
    expect(rules.forward.enabled).toBe(true);
    expect(rules.forward.address).toBe('user@test.com');
    expect(rules.forward.keepCopy).toBe(true);
    expect(rules.vacation.enabled).toBe(false);
    expect(rules.block.enabled).toBe(false);
  });

  it('parses block addresses', () => {
    const script = [
      '# dms-gui:forward:begin',
      '# dms-gui:forward:enabled=false',
      '# dms-gui:forward:end',
      '# dms-gui:vacation:begin',
      '# dms-gui:vacation:enabled=false',
      '# dms-gui:vacation:end',
      '# dms-gui:block:begin',
      '# dms-gui:block:enabled=true',
      '# dms-gui:block:addresses=spam@bad.com,junk@worse.com',
      '# dms-gui:block:end',
    ].join('\n');

    const rules = parseSieveScript(script);
    expect(rules.block.enabled).toBe(true);
    expect(rules.block.addresses).toEqual(['spam@bad.com', 'junk@worse.com']);
  });

  it('parses vacation with all fields', () => {
    const script = [
      '# dms-gui:forward:begin',
      '# dms-gui:forward:enabled=false',
      '# dms-gui:forward:end',
      '# dms-gui:vacation:begin',
      '# dms-gui:vacation:enabled=true',
      '# dms-gui:vacation:subject=Out of office',
      '# dms-gui:vacation:message=I will return on Monday.',
      '# dms-gui:vacation:days=14',
      '# dms-gui:vacation:end',
      '# dms-gui:block:begin',
      '# dms-gui:block:enabled=false',
      '# dms-gui:block:end',
    ].join('\n');

    const rules = parseSieveScript(script);
    expect(rules.vacation.enabled).toBe(true);
    expect(rules.vacation.subject).toBe('Out of office');
    expect(rules.vacation.message).toBe('I will return on Monday.');
    expect(rules.vacation.days).toBe(14);
  });
});

describe('round-trip: generate then parse', () => {
  it('preserves all-disabled rules', () => {
    const original = defaultRules();
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.forward.enabled).toBe(false);
    expect(parsed.vacation.enabled).toBe(false);
    expect(parsed.block.enabled).toBe(false);
  });

  it('preserves forward with keepCopy=true', () => {
    const original = defaultRules();
    original.forward = {
      enabled: true,
      address: 'alice@example.com',
      keepCopy: true,
    };
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.forward.enabled).toBe(true);
    expect(parsed.forward.address).toBe('alice@example.com');
    expect(parsed.forward.keepCopy).toBe(true);
  });

  it('preserves forward with keepCopy=false', () => {
    const original = defaultRules();
    original.forward = {
      enabled: true,
      address: 'bob@example.com',
      keepCopy: false,
    };
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.forward.enabled).toBe(true);
    expect(parsed.forward.address).toBe('bob@example.com');
    expect(parsed.forward.keepCopy).toBe(false);
  });

  it('preserves vacation with all fields', () => {
    const original = defaultRules();
    original.vacation = {
      enabled: true,
      subject: 'Holiday',
      message: 'Back on Jan 5.',
      days: 10,
    };
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.vacation.enabled).toBe(true);
    expect(parsed.vacation.subject).toBe('Holiday');
    expect(parsed.vacation.message).toBe('Back on Jan 5.');
    expect(parsed.vacation.days).toBe(10);
  });

  it('preserves block addresses', () => {
    const original = defaultRules();
    original.block = {
      enabled: true,
      addresses: ['a@b.com', 'c@d.com', 'e@f.com'],
    };
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.block.enabled).toBe(true);
    expect(parsed.block.addresses).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
  });

  it('preserves all rules enabled together', () => {
    const original = {
      forward: { enabled: true, address: 'fwd@test.com', keepCopy: true },
      vacation: { enabled: true, subject: 'OOO', message: 'Gone.', days: 3 },
      block: { enabled: true, addresses: ['bad@evil.com'] },
    };
    const script = generateSieveScript(original);
    const parsed = parseSieveScript(script);

    expect(parsed.forward).toEqual(original.forward);
    expect(parsed.vacation).toEqual(original.vacation);
    expect(parsed.block).toEqual(original.block);
  });
});

describe('getSieveRules — CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls doveadm_sieve_list then doveadm_sieve_get when script exists, returns parsed rules', async () => {
    execAction
      .mockResolvedValueOnce({
        returncode: 0,
        stdout: 'roundcube ACTIVE\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        returncode: 0,
        stdout: [
          '# dms-gui:forward:begin',
          '# dms-gui:forward:enabled=false',
          '# dms-gui:forward:end',
          '# dms-gui:vacation:begin',
          '# dms-gui:vacation:enabled=false',
          '# dms-gui:vacation:days=7',
          '# dms-gui:vacation:end',
          '# dms-gui:block:begin',
          '# dms-gui:block:enabled=false',
          '# dms-gui:block:end',
        ].join('\n'),
        stderr: '',
      });

    const result = await getSieveRules('mailserver', 'user@example.com');

    expect(result.success).toBe(true);
    expect(result.message.scriptExists).toBe(true);
    expect(result.message.isActive).toBe(true);
    expect(result.message.rules).not.toBeNull();
    expect(execAction).toHaveBeenCalledTimes(2);
    expect(execAction.mock.calls[0][0]).toBe('doveadm_sieve_list');
    expect(execAction.mock.calls[0][1]).toEqual({
      mailbox: 'user@example.com',
    });
    expect(execAction.mock.calls[1][0]).toBe('doveadm_sieve_get');
    expect(execAction.mock.calls[1][1]).toEqual({
      mailbox: 'user@example.com',
    });
  });

  it('does NOT call doveadm_sieve_get when list returns empty (no script)', async () => {
    execAction.mockResolvedValueOnce({
      returncode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await getSieveRules('mailserver', 'user@example.com');

    expect(result.success).toBe(true);
    expect(result.message.scriptExists).toBe(false);
    expect(result.message.rules).toBeNull();
    // Only the list call was made
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction.mock.calls[0][0]).toBe('doveadm_sieve_list');
  });
});

describe('saveSieveRules — CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls doveadm_sieve_put then doveadm_sieve_activate on success', async () => {
    execAction
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }) // put
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }); // activate

    const rules = defaultRules();
    const result = await saveSieveRules(
      'mailserver',
      'user@example.com',
      rules
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Sieve rules saved/);
    expect(execAction).toHaveBeenCalledTimes(2);
    // First call: put — mailbox correct, b64 is a non-empty base64 string
    expect(execAction.mock.calls[0][0]).toBe('doveadm_sieve_put');
    expect(execAction.mock.calls[0][1].mailbox).toBe('user@example.com');
    expect(execAction.mock.calls[0][1].b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Second call: activate
    expect(execAction.mock.calls[1][0]).toBe('doveadm_sieve_activate');
    expect(execAction.mock.calls[1][1]).toEqual({
      mailbox: 'user@example.com',
    });
  });

  it('does NOT call doveadm_sieve_activate if put fails', async () => {
    execAction.mockResolvedValueOnce({
      returncode: 1,
      stdout: '',
      stderr: 'quota exceeded',
    });

    const rules = defaultRules();
    const result = await saveSieveRules(
      'mailserver',
      'user@example.com',
      rules
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to save sieve script/);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction.mock.calls[0][0]).toBe('doveadm_sieve_put');
  });
});

describe('deleteSieveRules — CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls doveadm_sieve_deactivate then doveadm_sieve_delete on success', async () => {
    execAction
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }) // deactivate
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }); // delete

    const result = await deleteSieveRules('mailserver', 'user@example.com');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Sieve rules deleted/);
    expect(execAction).toHaveBeenCalledTimes(2);
    expect(execAction.mock.calls[0][0]).toBe('doveadm_sieve_deactivate');
    expect(execAction.mock.calls[0][1]).toEqual({
      mailbox: 'user@example.com',
    });
    expect(execAction.mock.calls[1][0]).toBe('doveadm_sieve_delete');
    expect(execAction.mock.calls[1][1]).toEqual({
      mailbox: 'user@example.com',
    });
  });

  it('still calls doveadm_sieve_delete even when deactivate fails (no active script)', async () => {
    execAction
      .mockResolvedValueOnce({
        returncode: 1,
        stdout: '',
        stderr: 'no active script',
      }) // deactivate fails
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }); // delete succeeds

    const result = await deleteSieveRules('mailserver', 'user@example.com');

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(2);
    expect(execAction.mock.calls[1][0]).toBe('doveadm_sieve_delete');
  });
});
