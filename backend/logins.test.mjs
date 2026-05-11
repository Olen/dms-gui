import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture all debugLog calls to verify password redaction
const mockDebugLog = vi.fn();
const mockErrorLog = vi.fn();
const mockSuccessLog = vi.fn();
const mockWarnLog = vi.fn();
const mockInfoLog = vi.fn();
const mockExecAction = vi.fn();

vi.mock('./backend.mjs', () => ({
  debugLog: (...args) => mockDebugLog(...args),
  errorLog: (...args) => mockErrorLog(...args),
  successLog: (...args) => mockSuccessLog(...args),
  warnLog: (...args) => mockWarnLog(...args),
  infoLog: (...args) => mockInfoLog(...args),
  execAction: (...args) => mockExecAction(...args),
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
      // Match production: the primary-key column for the logins table
      // is named 'id', and the bind-by-id statement uses @id.
      id: 'id',
      insert: { login: 'INSERT INTO logins ...' },
      select: {
        login: 'SELECT * FROM logins WHERE id = @id',
        loginGuess:
          'SELECT * FROM logins WHERE mailbox = @mailbox OR username = @username',
        loginByMailbox: 'SELECT * FROM logins WHERE mailbox = @mailbox',
        loginByUsername: 'SELECT * FROM logins WHERE username = @username',
        roles: 'SELECT roles FROM logins WHERE id = @id',
        rolesByMailbox: 'SELECT roles FROM logins WHERE mailbox = @mailbox',
        rolesByUsername: 'SELECT roles FROM logins WHERE username = @username',
      },
    },
  },
}));

vi.mock('../common.mjs', () => ({}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

import { addLogin, getLogin, getRoles, loginUser } from './logins.mjs';
import { dbGet, sql } from './db.mjs';

describe('addLogin — password redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never logs the cleartext password', async () => {
    const secretPassword = 'SuperSecret123!';

    await addLogin(
      'user@example.com', // mailbox
      'testuser', // username
      secretPassword, // password — must NOT appear in logs
      'user@example.com', // email
      0, // isAdmin
      0, // isAccount
      1, // isActive
      'test-mailserver', // mailserver
      ['user@example.com'] // roles
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
    expect(result).toEqual({
      success: false,
      message: 'invalid credential key',
    });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('accepts valid key and calls dbGet', async () => {
    dbGet.mockReturnValueOnce({ success: false });
    await getLogin({ id: 'test' });
    expect(dbGet).toHaveBeenCalled();
  });

  it('treats a string credential as a mailbox (issue #39)', async () => {
    // The fix is specifically for the guess=false branch: a bare
    // getLogin(string) — i.e., the GET /api/roles/:credential and
    // similar contracts where the input is contractually a mailbox.
    // The login flow still uses guess=true (loginGuess, mailbox-OR-
    // username) and is unaffected by this test. The previous form
    // keyed by the primary-key id column and silently returned 0
    // rows for any mailbox-shape input — this asserts the fix.
    dbGet.mockReturnValueOnce({ success: false });
    await getLogin('user@example.com');
    // Assert the *exact* prepared statement, not a substring — a column
    // list that happens to mention "mailbox" elsewhere mustn't pass.
    expect(dbGet).toHaveBeenCalledWith(sql.logins.select.loginByMailbox, {
      mailbox: 'user@example.com',
    });
  });
});

describe('getRoles — key validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid credential key', async () => {
    const result = await getRoles({ badKey: 'test' });
    expect(result).toEqual({
      success: false,
      message: 'invalid credential key',
    });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('accepts valid key and calls dbGet', async () => {
    dbGet.mockReturnValueOnce({ success: true, message: '["admin"]' });
    const result = await getRoles({ mailbox: 'user@test.com' });
    expect(dbGet).toHaveBeenCalled();
    expect(result).toEqual({ success: true, message: ['admin'] });
  });

  it('treats a string credential as a mailbox', async () => {
    // The GET /api/roles/:credential route hands its :credential path
    // param to getRoles() as a string and is contractually a mailbox
    // (non-admins are restricted to req.user.mailbox). The previous
    // form keyed by the primary-key id column instead.
    dbGet.mockReturnValueOnce({ success: true, message: '["user@test.com"]' });
    await getRoles('user@test.com');
    // Assert the *exact* prepared statement, not a substring.
    expect(dbGet).toHaveBeenCalledWith(sql.logins.select.rolesByMailbox, {
      mailbox: 'user@test.com',
    });
  });
});

describe('loginUser — doveadm auth test dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls execAction doveadm_auth_test with correct mailbox/password and returns success on returncode 0', async () => {
    // getLogin (guess=true) uses dbGet with loginGuess statement.
    // Return a login row with isAccount=1 so the doveadm path is taken.
    dbGet.mockReturnValueOnce({
      success: true,
      message: {
        mailbox: 'user@example.com',
        username: 'user@example.com',
        isAdmin: 0,
        isActive: 1,
        isAccount: 1,
        mailserver: 'test-mailserver',
        roles: '[]',
      },
    });
    mockExecAction.mockResolvedValueOnce({
      returncode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await loginUser('user@example.com', 'correctpassword');

    expect(result.success).toBe(true);
    expect(mockExecAction).toHaveBeenCalledTimes(1);
    expect(mockExecAction).toHaveBeenCalledWith(
      'doveadm_auth_test',
      { mailbox: 'user@example.com', password: 'correctpassword' },
      expect.objectContaining({ timeout: 5 })
    );
  });

  it('returns success=false with invalid-password message when doveadm returns non-zero', async () => {
    dbGet.mockReturnValueOnce({
      success: true,
      message: {
        mailbox: 'user@example.com',
        username: 'user@example.com',
        isAdmin: 0,
        isActive: 1,
        isAccount: 1,
        mailserver: 'test-mailserver',
        roles: '[]',
      },
    });
    mockExecAction.mockResolvedValueOnce({
      returncode: 1,
      stdout: '',
      stderr: 'auth error',
    });

    const result = await loginUser('user@example.com', 'wrongpassword');

    expect(result.success).toBe(false);
    // The message should reference the credential and indicate invalid password
    expect(result.message).toMatch(/password invalid/i);
  });

  it('does NOT call execAction when the user does not exist in DB', async () => {
    dbGet.mockReturnValueOnce({ success: false, message: 'not found' });

    const result = await loginUser('nobody@example.com', 'somepassword');

    expect(result.success).toBe(false);
    expect(mockExecAction).not.toHaveBeenCalled();
  });
});
