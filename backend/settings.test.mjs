// Unit tests for the targetDict classification helper extracted from
// getServerStatus's no-Authorization branch (#49). The full
// getServerStatus integration is much larger and depends on the DB,
// execSetup, etc.; this test surface deliberately covers only the
// classification logic that issue #49 corrects.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execCommand: vi.fn(),
  execSetup: vi.fn(),
  ping: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('./env.mjs', () => ({
  env: { isMutable: 1, isImmutable: 0, DKIM_KEYTYPE_DEFAULT: 'rsa' },
  command: {},
  mailserverRESTAPI: {},
}));

vi.mock('./db.mjs', () => ({
  dbAll: vi.fn(),
  dbCount: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  getTargetDict: vi.fn(),
  sql: {
    settings: { select: {}, insert: {} },
    configs: { select: {}, insert: {}, delete: {} },
    accounts: { select: {} },
    aliases: { select: {} },
    logins: { select: {} },
    domains: { select: {} },
  },
}));

vi.mock('./topParser.mjs', () => ({ processTopData: vi.fn() }));
vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));
vi.mock('./demoData.mjs', () => ({ demoData: {} }));

import { classifyMissingAuthTargetDict } from './settings.mjs';

describe('classifyMissingAuthTargetDict (#49)', () => {
  it('returns unknown for null targetDict', () => {
    expect(classifyMissingAuthTargetDict(null)).toEqual({
      status: 'unknown',
      error: 'No targetDict provided',
    });
  });

  it('returns unknown for undefined targetDict', () => {
    expect(classifyMissingAuthTargetDict(undefined)).toEqual({
      status: 'unknown',
      error: 'No targetDict provided',
    });
  });

  it('propagates getTargetDict failure-shape error message', () => {
    // getTargetDict's catch-block returns { success: false, error: ... }.
    // Pre-#49 this fell into a generic "Missing elements in targetDict"
    // message and the actual error was lost.
    const failureShape = {
      success: false,
      error: 'getSettings failed: db locked',
    };
    expect(classifyMissingAuthTargetDict(failureShape)).toEqual({
      status: 'unknown',
      error: 'getSettings failed: db locked',
    });
  });

  it('handles failure shape without explicit error string', () => {
    expect(classifyMissingAuthTargetDict({ success: false })).toEqual({
      status: 'unknown',
      error: 'targetDict lookup failed',
    });
  });

  it('returns api_gen when targetDict has fields but no Authorization', () => {
    // The "real" success path of getTargetDict when DMS_API_KEY hasn't
    // been generated yet. Pre-#49 this incorrectly mapped to 'unknown'
    // (the inverted condition `Object.keys(targetDict).length` was
    // truthy for any non-empty object). The frontend already has UX
    // for 'api_gen' (FormContainerAdd.jsx + Dashboard.jsx) to prompt
    // the user to generate the key — this fix lets that UX trigger.
    const realDict = {
      containerName: 'mailserver',
      protocol: 'http',
      host: 'mailserver',
      port: '8888',
      Authorization: null,
      setupPath: '/usr/local/bin/setup',
      timeout: 4,
      schema: 'dms',
      scope: 'dms-gui',
    };
    expect(classifyMissingAuthTargetDict(realDict)).toEqual({
      status: 'api_gen',
      error: null,
    });
  });

  it('still returns api_gen when targetDict is an empty object', () => {
    // Theoretical edge case — getTargetDict won't actually return {}
    // in practice, but the previous logic mistakenly mapped this to
    // api_gen too. Behaviour preserved for parity.
    expect(classifyMissingAuthTargetDict({})).toEqual({
      status: 'api_gen',
      error: null,
    });
  });
});
