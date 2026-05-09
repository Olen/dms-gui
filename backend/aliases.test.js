import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test.
// Pattern matches backend/routes/accounts.test.js.
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execAction: vi.fn(),
  formatDMSError: vi.fn(async (_label, stderr) => stderr || 'dms error'),
}));

vi.mock('./env.mjs', () => ({
  env: { DMS_CONFIG_PATH: '/tmp/dms-config' },
}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

const mockDbAll = vi.fn();
const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
const mockDeleteEntry = vi.fn();
const mockGetTargetDict = vi.fn(() => ({
  host: 'localhost',
  protocol: 'http',
  port: 8888,
  Authorization: 'test-key',
  setupPath: '/usr/local/bin/setup',
}));

vi.mock('./db.mjs', () => ({
  dbAll: (...a) => mockDbAll(...a),
  dbRun: (...a) => mockDbRun(...a),
  dbGet: (...a) => mockDbGet(...a),
  deleteEntry: (...a) => mockDeleteEntry(...a),
  getTargetDict: (...a) => mockGetTargetDict(...a),
  sql: {
    aliases: {
      select: { aliases: 'SELECT ... aliases' },
      insert: { alias: 'REPLACE INTO aliases ...' },
      delete: { bySource: 'DELETE ... bySource' },
    },
  },
}));

const mockGetConfigs = vi.fn();
vi.mock('./settings.mjs', () => ({
  getConfigs: (...a) => mockGetConfigs(...a),
}));

import { execAction } from './backend.mjs';
import { updateAlias, getAliases, addAlias, deleteAlias } from './aliases.mjs';

describe('updateAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-op success when new destination equals old, without calling DMS or DB', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'a@example.com,b@example.com',
          regex: 0,
        },
      ],
    });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'a@example.com,b@example.com'
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no changes/i);
    expect(execAction).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('issues alias add for each added destination and updates DB on success', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'a@example.com', regex: 0 },
      ],
    });
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'a@example.com,b@example.com'
    );

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction).toHaveBeenCalledWith(
      'setup_alias_add',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'info@example.com',
        destination: 'b@example.com',
      },
      expect.any(Object)
    );
    // DB updated with the merged set
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source: 'info@example.com',
        destination: 'a@example.com,b@example.com',
        regex: 0,
      }),
      'mailserver'
    );
  });

  it('issues alias del for each removed destination', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'a@example.com,b@example.com',
          regex: 0,
        },
      ],
    });
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'a@example.com'
    );

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction).toHaveBeenCalledWith(
      'setup_alias_del',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'info@example.com',
        destination: 'b@example.com',
      },
      expect.any(Object)
    );
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ destination: 'a@example.com' }),
      'mailserver'
    );
  });

  it('handles a mixed diff: removes one, adds one', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'a@example.com,b@example.com',
          regex: 0,
        },
      ],
    });
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'b@example.com,c@example.com'
    );

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(2);
    // First: del a@; second: add c@. Order: removals before additions.
    expect(execAction.mock.calls[0]).toEqual([
      'setup_alias_del',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'info@example.com',
        destination: 'a@example.com',
      },
      expect.any(Object),
    ]);
    expect(execAction.mock.calls[1]).toEqual([
      'setup_alias_add',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'info@example.com',
        destination: 'c@example.com',
      },
      expect.any(Object),
    ]);
  });

  it('rejects regex aliases without calling DMS', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        { source: '/^info.*/', destination: 'a@example.com', regex: 1 },
      ],
    });

    const result = await updateAlias(
      'mailserver',
      '/^info.*/',
      'b@example.com'
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/regex aliases is not supported/i);
    expect(execAction).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('rejects when the alias does not exist in the DB', async () => {
    mockDbAll.mockReturnValue({ success: true, message: [] });

    const result = await updateAlias(
      'mailserver',
      'gone@example.com',
      'a@example.com'
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(execAction).not.toHaveBeenCalled();
  });

  it('rejects empty newDestination', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'a@example.com', regex: 0 },
      ],
    });

    const result = await updateAlias('mailserver', 'info@example.com', '');

    expect(result.success).toBe(false);
    expect(execAction).not.toHaveBeenCalled();
  });

  it('on partial failure, writes the actual surviving set to the DB', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        {
          source: 'info@example.com',
          destination: 'a@example.com,b@example.com',
          regex: 0,
        },
      ],
    });
    // First call (del a@) succeeds, second call (add c@) fails.
    execAction
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ returncode: 1, stdout: '', stderr: 'boom' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'b@example.com,c@example.com'
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Partially updated/);
    expect(result.error).toMatch(/c@example\.com/);

    // DB should be written with the actual surviving set: just b@example.com
    // (a@ was successfully removed; c@ failed to add).
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ destination: 'b@example.com' }),
      'mailserver'
    );
  });

  it('on full failure, leaves DB unchanged and returns the spec-mandated error', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'a@example.com', regex: 0 },
      ],
    });
    // All execAction calls fail.
    execAction.mockResolvedValue({ returncode: 1, stdout: '', stderr: 'boom' });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'b@example.com'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to update alias');
    // Critical: DB must NOT have been written.
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('returns "DB out of sync" when DMS partially succeeds but DB write fails', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [
        { source: 'info@example.com', destination: 'a@example.com', regex: 0 },
      ],
    });
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: false, error: 'disk full' });

    const result = await updateAlias(
      'mailserver',
      'info@example.com',
      'a@example.com,b@example.com'
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DB out of sync/);
    expect(result.error).toMatch(/disk full/);
  });
});

describe('getAliases — refresh path with non-admin roles', () => {
  // Regression test for a bug where the refresh path returned the
  // unfiltered alias list to non-admin callers (filter was applied to
  // result.message but `aliases` was returned, ignoring the filter).
  // See FOLLOWUPS.md F3.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('on refresh, applies the role filter before returning to non-admin callers', async () => {
    // getConfigs returns a single dms-schema config for the mailserver.
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [
        {
          value: 'mailserver',
          plugin: 'mailserver',
          schema: 'dms',
          scope: 'dms-gui',
        },
      ],
    });

    // Simulate the DMS `setup alias list` output: three aliases, two
    // pointing to the user's role and one to someone else's mailbox.
    // First execAction call is setup_alias_list; second is cat_postfix_regexp.
    execAction
      .mockResolvedValueOnce({
        returncode: 0,
        stderr: '',
        stdout: [
          '* alias-a@example.com user@example.com',
          '* alias-b@example.com user@example.com',
          '* alias-c@example.com other@example.com',
        ].join('\n'),
      })
      .mockResolvedValueOnce({ returncode: 0, stderr: '', stdout: '' });

    // DB writes succeed.
    mockDbRun.mockReturnValue({ success: true });
    mockDeleteEntry.mockReturnValue({ success: true });

    const result = await getAliases(
      'mailserver',
      /*refresh*/ true,
      /*roles*/ ['user@example.com']
    );

    expect(result.success).toBe(true);
    // Only the two aliases destined for the user's role should be returned.
    expect(result.message).toHaveLength(2);
    expect(
      result.message.every((a) => a.destination === 'user@example.com')
    ).toBe(true);
    // Make sure the leaked alias is not present.
    expect(
      result.message.find((a) => a.destination === 'other@example.com')
    ).toBeUndefined();
  });

  it('on refresh, returns the full list to admin callers (roles=[])', async () => {
    mockGetConfigs.mockResolvedValue({
      success: true,
      message: [
        {
          value: 'mailserver',
          plugin: 'mailserver',
          schema: 'dms',
          scope: 'dms-gui',
        },
      ],
    });
    // First execAction call is setup_alias_list; second is cat_postfix_regexp.
    execAction
      .mockResolvedValueOnce({
        returncode: 0,
        stderr: '',
        stdout: [
          '* alias-a@example.com user@example.com',
          '* alias-c@example.com other@example.com',
        ].join('\n'),
      })
      .mockResolvedValueOnce({ returncode: 0, stderr: '', stdout: '' });
    mockDbRun.mockReturnValue({ success: true });
    mockDeleteEntry.mockReturnValue({ success: true });

    const result = await getAliases(
      'mailserver',
      /*refresh*/ true,
      /*roles*/ []
    );

    expect(result.success).toBe(true);
    expect(result.message).toHaveLength(2);
  });
});

describe('addAlias — email path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setup_alias_add with correct args and returns success', async () => {
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await addAlias(
      'mailserver',
      'alias@example.com',
      'user@example.com'
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Alias created/);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction).toHaveBeenCalledWith(
      'setup_alias_add',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'alias@example.com',
        destination: 'user@example.com',
      },
      expect.any(Object)
    );
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        source: 'alias@example.com',
        destination: 'user@example.com',
        regex: 0,
      }),
      'mailserver'
    );
  });

  it('returns error (no DB write) when setup_alias_add fails', async () => {
    execAction.mockResolvedValue({
      returncode: 1,
      stdout: '',
      stderr: 'setup error',
    });

    const result = await addAlias(
      'mailserver',
      'alias@example.com',
      'user@example.com'
    );

    expect(result.success).toBe(false);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(mockDbRun).not.toHaveBeenCalled();
  });
});

describe('addAlias — regex path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls postfix_regexp_append then postfix_reload on success, preserving regex metacharacters', async () => {
    // Use a realistic postfix-regexp source that contains regex metacharacters.
    const regexSource = '/^abuse@.*$/';
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await addAlias(
      'mailserver',
      regexSource,
      'admin@example.com'
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Alias regex created/);
    expect(execAction).toHaveBeenCalledTimes(2);
    // First: append the line — source must be preserved verbatim including metacharacters
    expect(execAction.mock.calls[0]).toEqual([
      'postfix_regexp_append',
      { line: `${regexSource} admin@example.com` },
      expect.any(Object),
    ]);
    // Second: reload postfix
    expect(execAction.mock.calls[1]).toEqual([
      'postfix_reload',
      {},
      expect.any(Object),
    ]);
  });

  it('does NOT call postfix_reload if postfix_regexp_append fails', async () => {
    const regexSource = '/^abuse@.*$/';
    execAction.mockResolvedValue({
      returncode: 1,
      stdout: '',
      stderr: 'write error',
    });

    const result = await addAlias(
      'mailserver',
      regexSource,
      'admin@example.com'
    );

    expect(result.success).toBe(false);
    // Only the first call (append) should have been made
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction.mock.calls[0][0]).toBe('postfix_regexp_append');
    expect(mockDbRun).not.toHaveBeenCalled();
  });
});

describe('deleteAlias — email path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setup_alias_del for each destination and removes DB entry on full success', async () => {
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDeleteEntry.mockReturnValue({ success: true });

    const result = await deleteAlias(
      'mailserver',
      'alias@example.com',
      'user@example.com'
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/Alias deleted/);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction).toHaveBeenCalledWith(
      'setup_alias_del',
      {
        setup_path: '/usr/local/bin/setup',
        source: 'alias@example.com',
        destination: 'user@example.com',
      },
      expect.any(Object)
    );
    expect(mockDeleteEntry).toHaveBeenCalled();
  });

  it('calls setup_alias_del for each destination in a multi-destination alias', async () => {
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDeleteEntry.mockReturnValue({ success: true });

    const result = await deleteAlias(
      'mailserver',
      'alias@example.com',
      'a@example.com,b@example.com'
    );

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(2);
    expect(execAction.mock.calls[0][1]).toMatchObject({
      destination: 'a@example.com',
    });
    expect(execAction.mock.calls[1][1]).toMatchObject({
      destination: 'b@example.com',
    });
  });
});

describe('deleteAlias — regex path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls 3 actions in sequence and returns success', async () => {
    const regexSource = '/^abuse@.*$/';
    execAction.mockResolvedValue({ returncode: 0, stdout: '', stderr: '' });
    mockDeleteEntry.mockReturnValue({ success: true });

    const result = await deleteAlias(
      'mailserver',
      regexSource,
      'admin@example.com'
    );

    expect(result.success).toBe(true);
    expect(execAction).toHaveBeenCalledTimes(3);
    expect(execAction.mock.calls[0][0]).toBe('postfix_regexp_filter_to_tmp');
    expect(execAction.mock.calls[1][0]).toBe('tmp_postfix_regexp_to_final');
    expect(execAction.mock.calls[2][0]).toBe('postfix_reload');
  });

  it('does NOT call tmp_postfix_regexp_to_final if filter step fails', async () => {
    const regexSource = '/^abuse@.*$/';
    execAction.mockResolvedValue({
      returncode: 1,
      stdout: '',
      stderr: 'grep error',
    });

    const result = await deleteAlias(
      'mailserver',
      regexSource,
      'admin@example.com'
    );

    expect(result.success).toBe(false);
    expect(execAction).toHaveBeenCalledTimes(1);
    expect(execAction.mock.calls[0][0]).toBe('postfix_regexp_filter_to_tmp');
    expect(mockDeleteEntry).not.toHaveBeenCalled();
  });

  it('does NOT call postfix_reload if tmp_to_final step fails', async () => {
    const regexSource = '/^abuse@.*$/';
    execAction
      .mockResolvedValueOnce({ returncode: 0, stdout: '', stderr: '' }) // filter succeeds
      .mockResolvedValueOnce({ returncode: 1, stdout: '', stderr: 'mv error' }); // mv fails

    const result = await deleteAlias(
      'mailserver',
      regexSource,
      'admin@example.com'
    );

    expect(result.success).toBe(false);
    expect(execAction).toHaveBeenCalledTimes(2);
    expect(execAction.mock.calls[0][0]).toBe('postfix_regexp_filter_to_tmp');
    expect(execAction.mock.calls[1][0]).toBe('tmp_postfix_regexp_to_final');
  });
});
