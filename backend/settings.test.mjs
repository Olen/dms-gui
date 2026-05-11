// Unit tests for the targetDict classification helper extracted from
// getServerStatus's no-Authorization branch. The full getServerStatus
// integration is much larger and depends on the DB, execAction, etc.;
// this test surface deliberately covers only the classification logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable references so individual tests can stub env.DMSGUI_VERSION
// and mailserverRESTAPI without re-mocking the module per test.
const { mockEnv, mockRESTAPI, mockWriteFile } = vi.hoisted(() => ({
  mockEnv: {
    isMutable: 1,
    isImmutable: 0,
    DKIM_KEYTYPE_DEFAULT: 'rsa',
    DMS_CONFIG_PATH: '/tmp/docker-mailserver',
    DMSGUI_VERSION: 'test',
  },
  mockRESTAPI: {},
  mockWriteFile: vi.fn(),
}));

vi.mock('./backend.mjs', () => ({
  debugLog: vi.fn(),
  errorLog: vi.fn(),
  successLog: vi.fn(),
  warnLog: vi.fn(),
  infoLog: vi.fn(),
  execAction: vi.fn(),
  execCommand: vi.fn(), // documents the contract; prevents silent breakage if future tests exercise killContainer path
  ping: vi.fn(),
  writeFile: (...args) => mockWriteFile(...args),
}));

vi.mock('./env.mjs', () => ({
  env: mockEnv,
  command: {},
  mailserverRESTAPI: mockRESTAPI,
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

import {
  classifyMissingAuthTargetDict,
  createAPIfiles,
  generateDkim,
} from './settings.mjs';
import { execAction } from './backend.mjs';
import { getTargetDict } from './db.mjs';

describe('classifyMissingAuthTargetDict', () => {
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
    // A previous implementation fell into a generic "Missing elements
    // in targetDict" message and lost the actual error.
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
    // been generated yet. A previous form incorrectly mapped to 'unknown'
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

describe('createAPIfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mailserverRESTAPI mock between tests.
    for (const k of Object.keys(mockRESTAPI)) delete mockRESTAPI[k];
    mockWriteFile.mockResolvedValue({ success: true });
    mockEnv.DMSGUI_VERSION = '2.4.0';
  });

  it('substitutes EVERY {DMSGUI_VERSION} occurrence (not just the first)', async () => {
    // Regression for the substitution bug: rest-api.py.in carries the
    // placeholder in TWO sites (the header comment and the
    // REST_API_VERSION constant that drives the X-Rest-Api-Version
    // response header). A plain String#replace would leave the second
    // one as the literal string, and drift detection on the dms-gui
    // side would always see "rest-api.py at {DMSGUI_VERSION}" and
    // surface a false mismatch on every request.
    mockRESTAPI.dms = {
      api: {
        path: '/tmp/rest-api.py',
        content:
          '#!/usr/bin/python3\n' +
          '# version={DMSGUI_VERSION}\n' +
          "REST_API_VERSION = '{DMSGUI_VERSION}'\n",
      },
    };

    const result = await createAPIfiles('dms');

    expect(result.success).toBe(true);
    const [, written] = mockWriteFile.mock.calls[0];
    expect(written).not.toContain('{DMSGUI_VERSION}');
    expect(written).toContain('# version=2.4.0');
    expect(written).toContain("REST_API_VERSION = '2.4.0'");
  });

  it('does not touch {DMSGUI_VERSION} inside .json manifest content', async () => {
    // A future action whose argv template literally contains
    // '{DMSGUI_VERSION}' must not be silently rewritten — the
    // manifest is data, not a template.
    mockRESTAPI.dms = {
      manifest: {
        path: '/tmp/rest-api-manifest.json',
        content: '[{"id":"foo","argv":["echo","{DMSGUI_VERSION}"]}]',
      },
    };

    await createAPIfiles('dms');

    const [, written] = mockWriteFile.mock.calls[0];
    expect(written).toBe('[{"id":"foo","argv":["echo","{DMSGUI_VERSION}"]}]');
  });
});
