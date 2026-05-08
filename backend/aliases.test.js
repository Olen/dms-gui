import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test.
// Pattern matches backend/routes/accounts.test.js.
vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execCommand: vi.fn(),
  execSetup: vi.fn(),
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
const mockGetTargetDict = vi.fn(() => ({ host: 'localhost' }));

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

vi.mock('./settings.mjs', () => ({
  getConfigs: vi.fn(),
}));

import { execSetup } from './backend.mjs';
import { updateAlias } from './aliases.mjs';

describe('updateAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-op success when new destination equals old, without calling DMS or DB', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com,b@example.com');

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/no changes/i);
    expect(execSetup).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('issues alias add for each added destination and updates DB on success', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com,b@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(1);
    expect(execSetup).toHaveBeenCalledWith(
      expect.stringMatching(/^alias add 'info@example\.com' 'b@example\.com'$/),
      expect.any(Object),
    );
    // DB updated with the merged set
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }),
      'mailserver',
    );
  });

  it('issues alias del for each removed destination', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'a@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(1);
    expect(execSetup).toHaveBeenCalledWith(
      expect.stringMatching(/^alias del 'info@example\.com' 'b@example\.com'$/),
      expect.any(Object),
    );
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ destination: 'a@example.com' }),
      'mailserver',
    );
  });

  it('handles a mixed diff: removes one, adds one', async () => {
    mockDbAll.mockReturnValue({
      success: true,
      message: [{ source: 'info@example.com', destination: 'a@example.com,b@example.com', regex: 0 }],
    });
    execSetup.mockResolvedValue({ returncode: 0, stderr: '' });
    mockDbRun.mockReturnValue({ success: true });

    const result = await updateAlias('mailserver', 'info@example.com', 'b@example.com,c@example.com');

    expect(result.success).toBe(true);
    expect(execSetup).toHaveBeenCalledTimes(2);
    // First: del a@; second: add c@. Order: removals before additions.
    expect(execSetup.mock.calls[0][0]).toMatch(/^alias del 'info@example\.com' 'a@example\.com'$/);
    expect(execSetup.mock.calls[1][0]).toMatch(/^alias add 'info@example\.com' 'c@example\.com'$/);
  });
});
