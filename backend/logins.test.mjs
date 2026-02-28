import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture all debugLog calls to verify password redaction
const mockDebugLog = vi.fn();
const mockErrorLog = vi.fn();
const mockSuccessLog = vi.fn();
const mockWarnLog = vi.fn();
const mockInfoLog = vi.fn();
const mockExecCommand = vi.fn();

vi.mock('./backend.mjs', () => ({
  debugLog: (...args) => mockDebugLog(...args),
  errorLog: (...args) => mockErrorLog(...args),
  successLog: (...args) => mockSuccessLog(...args),
  warnLog: (...args) => mockWarnLog(...args),
  infoLog: (...args) => mockInfoLog(...args),
  execCommand: (...args) => mockExecCommand(...args),
}));

vi.mock('./db.mjs', () => ({
  dbRun: vi.fn(() => ({ success: true, message: 'ok' })),
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  getTargetDict: vi.fn(() => ({ host: 'localhost', timeout: 10 })),
  hashPassword: vi.fn(async () => ({ salt: 'fakesalt', hash: 'fakehash' })),
  verifyPassword: vi.fn(async () => true),
  sql: {
    logins: {
      id: 'mailbox',
      insert: { login: 'INSERT INTO logins ...' },
      select: {
        login: 'SELECT * FROM logins WHERE mailbox = @mailbox',
        loginObj: 'SELECT * FROM logins WHERE {key} = @value',
        loginGuess: 'SELECT * FROM logins WHERE mailbox = @mailbox OR username = @username',
        loginByMailbox: 'SELECT ...',
        loginByUsername: 'SELECT ...',
        loginById: 'SELECT ...',
        roles: 'SELECT roles FROM logins WHERE mailbox = @mailbox',
        rolesObj: 'SELECT roles FROM logins WHERE {key} = @value',
      },
    },
  },
}));

vi.mock('../common.mjs', () => ({}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

import { addLogin, getLogin, getRoles } from './logins.mjs';
import { dbGet } from './db.mjs';

describe('addLogin — password redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never logs the cleartext password', async () => {
    const secretPassword = 'SuperSecret123!';

    await addLogin(
      'user@example.com',   // mailbox
      'testuser',           // username
      secretPassword,       // password — must NOT appear in logs
      'user@example.com',   // email
      0,                    // isAdmin
      0,                    // isAccount
      1,                    // isActive
      'test-mailserver',    // mailserver
      ['user@example.com'], // roles
    );

    // Verify debugLog was called
    expect(mockDebugLog).toHaveBeenCalled();

    // Check every argument of every debugLog call for password leaks
    for (const call of mockDebugLog.mock.calls) {
      for (const arg of call) {
        const str = JSON.stringify(arg);
        expect(str).not.toContain(secretPassword);
      }
    }

    // Also check successLog doesn't leak password
    for (const call of mockSuccessLog.mock.calls) {
      for (const arg of call) {
        const str = JSON.stringify(arg);
        expect(str).not.toContain(secretPassword);
      }
    }
  });

  it('logs [REDACTED] in place of the password', async () => {
    await addLogin('user@example.com', 'testuser', 'mypassword');

    // The first debugLog call should contain [REDACTED]
    const firstCall = mockDebugLog.mock.calls[0];
    expect(firstCall).toContain('[REDACTED]');
  });

  it('does not leak password even when empty', async () => {
    await addLogin('user@example.com', 'testuser', '');

    const firstCall = mockDebugLog.mock.calls[0];
    expect(firstCall).toContain('[REDACTED]');
  });
});


describe('getLogin — key validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid credential key', async () => {
    const result = await getLogin({ invalidKey: 'test' });
    expect(result).toEqual({ success: false, message: 'invalid credential key' });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('accepts valid key and calls dbGet', async () => {
    dbGet.mockReturnValueOnce({ success: false });
    await getLogin({ id: 'test' });
    expect(dbGet).toHaveBeenCalled();
  });

  it('uses parameterized query for string credential', async () => {
    dbGet.mockReturnValueOnce({ success: false });
    await getLogin('user@example.com');
    expect(dbGet).toHaveBeenCalledWith(
      expect.any(String),
      { mailbox: 'user@example.com' },
    );
  });
});


describe('getRoles — key validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid credential key', async () => {
    const result = await getRoles({ badKey: 'test' });
    expect(result).toEqual({ success: false, message: 'invalid credential key' });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('accepts valid key and calls dbGet', async () => {
    dbGet.mockReturnValueOnce({ success: true, message: '["admin"]' });
    const result = await getRoles({ mailbox: 'user@test.com' });
    expect(dbGet).toHaveBeenCalled();
    expect(result).toEqual({ success: true, message: ['admin'] });
  });
});
