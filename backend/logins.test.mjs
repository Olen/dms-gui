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
      insert: { login: 'INSERT INTO logins ...' },
      select: {
        loginByMailbox: 'SELECT ...',
        loginByUsername: 'SELECT ...',
        loginById: 'SELECT ...',
      },
    },
  },
}));

vi.mock('../common.mjs', () => ({}));

import { addLogin } from './logins.mjs';

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
