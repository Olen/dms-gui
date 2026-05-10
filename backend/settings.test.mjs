// Unit tests for the targetDict classification helper extracted from
// getServerStatus's no-Authorization branch (#49). The full
// getServerStatus integration is much larger and depends on the DB,
// execAction, etc.; this test surface deliberately covers only the
// classification logic that issue #49 corrects.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execAction: vi.fn(),
  execCommand: vi.fn(), // documents the contract; prevents silent breakage if future tests exercise killContainer path
  ping: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('./env.mjs', () => ({
  env: {
    isMutable: 1,
    isImmutable: 0,
    DKIM_KEYTYPE_DEFAULT: 'rsa',
    DMS_CONFIG_PATH: '/tmp/docker-mailserver',
  },
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

import { classifyMissingAuthTargetDict, generateDkim } from './settings.mjs';
import { execAction } from './backend.mjs';
import { getTargetDict } from './db.mjs';

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

describe('generateDkim dispatch', () => {
  // generateDkim picks one of four manifest action ids based on the
  // (keytype, force) tuple. The argv templates differ — RSA bakes in
  // `keysize`, ed25519 omits it — so a wrong dispatch silently runs
  // a malformed setup.sh invocation. These tests pin the mapping.
  beforeEach(() => {
    vi.clearAllMocks();
    getTargetDict.mockReturnValue({
      setupPath: '/usr/local/bin/setup',
      Authorization: 'Bearer test',
    });
    // Make the dispatch call fail-fast so the function returns before
    // the post-generation mkdir/cp/chown chain (which we don't want
    // to assert on here — that's a separate concern).
    execAction.mockResolvedValue({
      returncode: 1,
      stderr: 'short-circuit',
      stdout: '',
    });
  });

  it('routes RSA without force to setup_dkim_generate_rsa with keysize', async () => {
    await generateDkim(
      'mailserver',
      'dms',
      'example.com',
      'rsa',
      '2048',
      'mail',
      false
    );
    expect(execAction).toHaveBeenCalledOnce();
    const [actionId, args] = execAction.mock.calls[0];
    expect(actionId).toBe('setup_dkim_generate_rsa');
    expect(args).toEqual({
      setup_path: '/usr/local/bin/setup',
      keytype: 'rsa',
      keysize: '2048',
      selector: 'mail',
      domain: 'example.com',
    });
  });

  it('routes RSA with force to setup_dkim_generate_rsa_force with keysize', async () => {
    await generateDkim(
      'mailserver',
      'dms',
      'example.com',
      'rsa',
      '4096',
      'mail',
      true
    );
    const [actionId, args] = execAction.mock.calls[0];
    expect(actionId).toBe('setup_dkim_generate_rsa_force');
    expect(args.keysize).toBe('4096');
  });

  it('routes ed25519 without force to setup_dkim_generate (no keysize)', async () => {
    await generateDkim(
      'mailserver',
      'dms',
      'example.com',
      'ed25519',
      '2048',
      'mail',
      false
    );
    const [actionId, args] = execAction.mock.calls[0];
    expect(actionId).toBe('setup_dkim_generate');
    expect(args).not.toHaveProperty('keysize');
  });

  it('routes ed25519 with force to setup_dkim_generate_force (no keysize)', async () => {
    await generateDkim(
      'mailserver',
      'dms',
      'example.com',
      'ed25519',
      '2048',
      'mail',
      true
    );
    const [actionId, args] = execAction.mock.calls[0];
    expect(actionId).toBe('setup_dkim_generate_force');
    expect(args).not.toHaveProperty('keysize');
  });

  it('lowercases domain and selector before dispatch', async () => {
    // The /i guard accepts uppercase, but the manifest validators are
    // case-sensitive lowercase-only — so the JS layer must normalise
    // before the manifest sees the values, or runtime validation fails.
    await generateDkim(
      'mailserver',
      'dms',
      'Example.COM',
      'rsa',
      '2048',
      'Mail',
      false
    );
    const [, args] = execAction.mock.calls[0];
    expect(args.domain).toBe('example.com');
    expect(args.selector).toBe('mail');
  });

  it('rejects invalid keytype before any execAction call', async () => {
    const result = await generateDkim(
      'mailserver',
      'dms',
      'example.com',
      'dsa',
      '2048',
      'mail',
      false
    );
    expect(result).toEqual({ success: false, error: 'Invalid keytype' });
    expect(execAction).not.toHaveBeenCalled();
  });
});
