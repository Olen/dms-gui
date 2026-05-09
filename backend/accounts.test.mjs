import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
const mockDebugLog = vi.fn();
const mockErrorLog = vi.fn();
const mockSuccessLog = vi.fn();
const mockWarnLog = vi.fn();
const mockInfoLog = vi.fn();
const mockExecAction = vi.fn();
const mockFormatDMSError = vi.fn();
const mockDeleteEntry = vi.fn();
const mockGetAliases = vi.fn();
const mockDeleteAlias = vi.fn();

vi.mock('./backend.mjs', () => ({
  debugLog: (...args) => mockDebugLog(...args),
  errorLog: (...args) => mockErrorLog(...args),
  successLog: (...args) => mockSuccessLog(...args),
  warnLog: (...args) => mockWarnLog(...args),
  infoLog: (...args) => mockInfoLog(...args),
  execAction: (...args) => mockExecAction(...args),
  formatDMSError: (...args) => mockFormatDMSError(...args),
}));

vi.mock('./db.mjs', () => ({
  dbAll: vi.fn(),
  dbRun: vi.fn(() => ({ success: true })),
  deleteEntry: (...args) => mockDeleteEntry(...args),
  getTargetDict: vi.fn(() => ({ host: 'localhost', timeout: 10 })),
  hashPassword: vi.fn(async () => ({ salt: 'x', hash: 'y' })),
  sql: {
    accounts: {
      select: { accounts: 'SELECT ...', count: 'SELECT ...' },
      insert: { account: 'INSERT ...' },
    },
    logins: { insert: { login: 'INSERT ...' } },
  },
}));

vi.mock('./aliases.mjs', () => ({
  addAlias: vi.fn(async () => ({ success: true })),
  getAliases: (...args) => mockGetAliases(...args),
  deleteAlias: (...args) => mockDeleteAlias(...args),
}));

vi.mock('../common.mjs', () => ({
  reduxArrayOfObjByValue: (array, key, values) =>
    array.filter((item) => values.includes(item[key])),
}));

vi.mock('./env.mjs', () => ({
  env: { DMS_CONFIG_PATH: '/tmp/docker-mailserver' },
}));

vi.mock('./logins.mjs', () => ({
  addLogin: vi.fn(async () => ({ success: true })),
}));

vi.mock('./settings.mjs', () => ({
  getConfigs: vi.fn(async () => ({
    success: true,
    message: [{ schema: 'dms' }],
  })),
}));

import { addAccount, deleteAccount } from './accounts.mjs';

describe('deleteAccount — alias cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DMS email del succeeds
    mockExecAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    // Default: DB delete succeeds
    mockDeleteEntry.mockReturnValue({ success: true, message: 'deleted' });
    // Default: deleteAlias succeeds
    mockDeleteAlias.mockResolvedValue({ success: true, message: 'deleted' });
  });

  it('deletes aliases where the mailbox is the destination', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'user@example.com',
          regex: 0,
        },
        {
          source: 'admin@example.com',
          destination: 'other@example.com',
          regex: 0,
        },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should only delete the alias that has user@example.com as destination
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'user@example.com'
    );
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });

  it('deletes aliases where the mailbox is the source', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        {
          source: 'user@example.com',
          destination: 'other@example.com',
          regex: 0,
        },
        {
          source: 'admin@example.com',
          destination: 'boss@example.com',
          regex: 0,
        },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete the alias where user@example.com is the source
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'user@example.com',
      'other@example.com'
    );
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });

  it('deletes aliases matching both source and destination', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        {
          source: 'user@example.com',
          destination: 'other@example.com',
          regex: 0,
        },
        {
          source: 'info@example.com',
          destination: 'user@example.com',
          regex: 0,
        },
        {
          source: 'admin@example.com',
          destination: 'boss@example.com',
          regex: 0,
        },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete both: one where source matches, one where destination matches
    expect(mockDeleteAlias).toHaveBeenCalledTimes(2);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'user@example.com',
      'other@example.com'
    );
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'user@example.com'
    );
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });

  it('handles comma-separated destinations when matching', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'alice@example.com,user@example.com',
          regex: 0,
        },
        {
          source: 'admin@example.com',
          destination: 'boss@example.com',
          regex: 0,
        },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should match user@example.com in the comma-separated destination
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'alice@example.com,user@example.com'
    );
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });

  it('does not delete unrelated aliases', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        {
          source: 'admin@example.com',
          destination: 'boss@example.com',
          regex: 0,
        },
        {
          source: 'info@example.com',
          destination: 'support@example.com',
          regex: 0,
        },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    expect(mockDeleteAlias).not.toHaveBeenCalled();
    // Positive assertion on execAction call shape (even when no aliases match)
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });

  it('handles empty alias list gracefully', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [],
    });

    const result = await deleteAccount(
      'dms',
      'test-mailserver',
      'user@example.com'
    );

    expect(mockDeleteAlias).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_del',
      { mailbox: 'user@example.com' },
      expect.objectContaining({ timeout: 60 })
    );
  });
});

describe('addAccount — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DMS email add succeeds
    mockExecAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
  });

  it('adds an account with execAction call shape verification', async () => {
    const result = await addAccount(
      'dms',
      'test-mailserver',
      'newuser@example.com',
      'testpassword'
    );

    // Should succeed
    expect(result.success).toBe(true);
    // Positive assertion on execAction call shape
    expect(mockExecAction).toHaveBeenCalledWith(
      'setup_email_add',
      { mailbox: 'newuser@example.com', password: 'testpassword' },
      expect.any(Object)
    );
  });
});

describe('addAccount / deleteAccount — schema allowlist (defence in depth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addAccount returns a structured error for an unsupported schema (does not crash)', async () => {
    const result = await addAccount(
      'mailcow',
      'test-mailserver',
      'u@e.com',
      'pw'
    );
    expect(result).toEqual({
      success: false,
      error: "unsupported schema 'mailcow'",
    });
    // Crucially, the function returned cleanly — no execAction invoked,
    // no exception thrown despite results never being initialised.
    expect(mockExecAction).not.toHaveBeenCalled();
  });

  it('deleteAccount returns a structured error for an unsupported schema (does not crash)', async () => {
    const result = await deleteAccount('mailcow', 'test-mailserver', 'u@e.com');
    expect(result).toEqual({
      success: false,
      error: "unsupported schema 'mailcow'",
    });
    expect(mockExecAction).not.toHaveBeenCalled();
  });
});
