import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
const mockDebugLog = vi.fn();
const mockErrorLog = vi.fn();
const mockSuccessLog = vi.fn();
const mockWarnLog = vi.fn();
const mockInfoLog = vi.fn();
const mockExecSetup = vi.fn();
const mockExecCommand = vi.fn();
const mockFormatDMSError = vi.fn();
const mockDeleteEntry = vi.fn();
const mockGetAliases = vi.fn();
const mockAddAlias = vi.fn();
const mockDeleteAlias = vi.fn();

vi.mock('./backend.mjs', () => ({
  debugLog: (...args) => mockDebugLog(...args),
  errorLog: (...args) => mockErrorLog(...args),
  successLog: (...args) => mockSuccessLog(...args),
  warnLog: (...args) => mockWarnLog(...args),
  infoLog: (...args) => mockInfoLog(...args),
  execSetup: (...args) => mockExecSetup(...args),
  execCommand: (...args) => mockExecCommand(...args),
  formatDMSError: (...args) => mockFormatDMSError(...args),
}));

vi.mock('./db.mjs', () => ({
  dbAll: vi.fn(),
  dbRun: vi.fn(() => ({ success: true })),
  deleteEntry: (...args) => mockDeleteEntry(...args),
  getTargetDict: vi.fn(() => ({ host: 'localhost', timeout: 10 })),
  hashPassword: vi.fn(async () => ({ salt: 'x', hash: 'y' })),
  sql: {
    accounts: { select: { accounts: 'SELECT ...', count: 'SELECT ...' }, insert: { account: 'INSERT ...' } },
    logins: { insert: { login: 'INSERT ...' } },
  },
}));

vi.mock('./aliases.mjs', () => ({
  addAlias: (...args) => mockAddAlias(...args),
  getAliases: (...args) => mockGetAliases(...args),
  deleteAlias: (...args) => mockDeleteAlias(...args),
}));

vi.mock('../common.mjs', () => ({
  reduxArrayOfObjByValue: (array, key, values) =>
    array.filter(item => values.includes(item[key])),
}));

vi.mock('./env.mjs', () => ({
  env: { DMS_CONFIG_PATH: '/tmp/docker-mailserver' },
}));

vi.mock('./logins.mjs', () => ({
  addLogin: vi.fn(async () => ({ success: true })),
}));

vi.mock('./settings.mjs', () => ({
  getConfigs: vi.fn(async () => ({ success: true, message: [{ schema: 'dms' }] })),
}));

import { deleteAccount } from './accounts.mjs';

describe('deleteAccount — alias cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DMS email del succeeds
    mockExecSetup.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    // Default: DB delete succeeds
    mockDeleteEntry.mockReturnValue({ success: true, message: 'deleted' });
    // Default: deleteAlias and addAlias succeed
    mockDeleteAlias.mockResolvedValue({ success: true, message: 'deleted' });
    mockAddAlias.mockResolvedValue({ success: true, message: 'created' });
  });

  it('deletes aliases where the mailbox is the destination', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'user@example.com', regex: 0 },
        { source: 'admin@example.com', destination: 'other@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should only delete the alias that has user@example.com as destination
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'user@example.com',
    );
  });

  it('deletes aliases where the mailbox is the source', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'user@example.com', destination: 'other@example.com', regex: 0 },
        { source: 'admin@example.com', destination: 'boss@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete the alias where user@example.com is the source
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'user@example.com',
      'other@example.com',
    );
  });

  it('deletes aliases matching both source and destination', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'user@example.com', destination: 'other@example.com', regex: 0 },
        { source: 'info@example.com', destination: 'user@example.com', regex: 0 },
        { source: 'admin@example.com', destination: 'boss@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete both: one where source matches, one where destination matches
    expect(mockDeleteAlias).toHaveBeenCalledTimes(2);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'user@example.com',
      'other@example.com',
    );
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'user@example.com',
    );
  });

  it('removes user from multi-destination alias and re-adds with remaining', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'alice@example.com,user@example.com', regex: 0 },
        { source: 'admin@example.com', destination: 'boss@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete the old multi-destination alias
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'alice@example.com,user@example.com',
    );
    // Should re-add with remaining destinations only
    expect(mockAddAlias).toHaveBeenCalledTimes(1);
    expect(mockAddAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'alice@example.com',
    );
  });

  it('deletes entire alias when user is the sole destination', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'user@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    // Should delete the alias entirely
    expect(mockDeleteAlias).toHaveBeenCalledTimes(1);
    expect(mockDeleteAlias).toHaveBeenCalledWith(
      'test-mailserver',
      'info@example.com',
      'user@example.com',
    );
    // Should NOT re-add since there are no remaining destinations
    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('does not delete unrelated aliases', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [
        { source: 'admin@example.com', destination: 'boss@example.com', regex: 0 },
        { source: 'info@example.com', destination: 'support@example.com', regex: 0 },
      ],
    });

    await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    expect(mockDeleteAlias).not.toHaveBeenCalled();
  });

  it('handles empty alias list gracefully', async () => {
    mockGetAliases.mockResolvedValue({
      success: true,
      message: [],
    });

    const result = await deleteAccount('dms', 'test-mailserver', 'user@example.com');

    expect(mockDeleteAlias).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
