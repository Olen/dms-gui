import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebugLog = vi.fn();
const mockErrorLog = vi.fn();
const mockExecAction = vi.fn();

vi.mock('./backend.mjs', () => ({
  debugLog: (...a) => mockDebugLog(...a),
  errorLog: (...a) => mockErrorLog(...a),
  execAction: (...a) => mockExecAction(...a),
}));

vi.mock('./db.mjs', () => ({
  getTargetDict: vi.fn(() => ({ host: 'mail', timeout: 10 })),
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  sql: { bayesLearned: { select: { allMap: '', byMsgId: '' } } },
}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
  demoWriteResponse: vi.fn(() => null),
}));

import {
  bayesUsersActionFor,
  getRspamdBayesUsers,
  getRspamdConfig,
} from './rspamd.mjs';

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: build a deterministic mock from a `path -> {returncode, stdout}` map.
// rspamd.getRspamdConfig issues four cat_rspamd_config calls in a fixed
// order; we capture them by path so test assertions don't depend on call order.
const buildExec =
  (catResponses) => async (action, args /*, target, opts */) => {
    if (action !== 'cat_rspamd_config') {
      return { returncode: 0, stdout: '', stderr: '' };
    }
    return catResponses[args.path] ?? { returncode: 1, stdout: '', stderr: '' };
  };

const ACTIONS_TEXT = `
reject = 15;
add_header = 6;
greylist = 4;
rewrite_subject = 10;
`;

// The bayes-config parser matches `score\s*>=\s*N` and `score\s*<=\s*-?N`
// in the file text, so the fixture only needs to expose those two
// shapes; we don't need a full rspamd config block here.
const BAYES_OVERRIDE = `
min_learns = 200;
score >= 12.0
score <= -6.0
`;

const BAYES_LOCAL = `
min_learns = 50;
score >= 6.0
score <= -3.0
`;

describe('getRspamdConfig — classifier-bayes.conf precedence', () => {
  // PR #107 round-4 fixed a regression where local.d was read before
  // override.d for the bayes block, inconsistent with actions.conf and
  // with rspamd's own load order (override.d is loaded LAST, so its
  // settings win at runtime). These tests lock the precedence in.

  it('uses override.d/classifier-bayes.conf when both files are present', async () => {
    mockExecAction.mockImplementation(
      buildExec({
        '/etc/rspamd/override.d/actions.conf': {
          returncode: 0,
          stdout: ACTIONS_TEXT,
        },
        '/etc/rspamd/override.d/classifier-bayes.conf': {
          returncode: 0,
          stdout: BAYES_OVERRIDE,
        },
        '/etc/rspamd/local.d/classifier-bayes.conf': {
          returncode: 0,
          stdout: BAYES_LOCAL,
        },
      })
    );

    const r = await getRspamdConfig('mailserver', 'dms');

    expect(r.success).toBe(true);
    // override.d's bayes values win — min_learns=200, spam_threshold=12
    expect(r.message.bayes).toMatchObject({
      min_learns: 200,
      spam_threshold: 12,
      ham_threshold: -6,
    });
  });

  it('falls back to local.d/classifier-bayes.conf when override.d is absent', async () => {
    mockExecAction.mockImplementation(
      buildExec({
        '/etc/rspamd/override.d/actions.conf': {
          returncode: 0,
          stdout: ACTIONS_TEXT,
        },
        '/etc/rspamd/local.d/classifier-bayes.conf': {
          returncode: 0,
          stdout: BAYES_LOCAL,
        },
        // override.d/classifier-bayes.conf intentionally absent
      })
    );

    const r = await getRspamdConfig('mailserver', 'dms');

    expect(r.success).toBe(true);
    expect(r.message.bayes).toMatchObject({
      min_learns: 50,
      spam_threshold: 6,
      ham_threshold: -3,
    });
  });

  it('parses actions.conf alongside the bayes block', async () => {
    mockExecAction.mockImplementation(
      buildExec({
        '/etc/rspamd/override.d/actions.conf': {
          returncode: 0,
          stdout: ACTIONS_TEXT,
        },
        '/etc/rspamd/override.d/classifier-bayes.conf': {
          returncode: 0,
          stdout: BAYES_OVERRIDE,
        },
      })
    );

    const r = await getRspamdConfig('mailserver', 'dms');

    expect(r.success).toBe(true);
    expect(r.message.actions).toEqual({
      reject: 15,
      add_header: 6,
      greylist: 4,
      rewrite_subject: 10,
    });
  });
});

describe('bayesUsersActionFor', () => {
  it('uses redis-cli up to DMS v16', () => {
    expect(bayesUsersActionFor('v15.1.0')).toBe('redis_eval_bayes_users');
    expect(bayesUsersActionFor('v16.0.1')).toBe('redis_eval_bayes_users');
  });

  it('uses valkey-cli from DMS v17', () => {
    expect(bayesUsersActionFor('v17.0.0')).toBe('valkey_eval_bayes_users');
    expect(bayesUsersActionFor('v18.2.3')).toBe('valkey_eval_bayes_users');
  });

  it('uses valkey-cli for edge builds', () => {
    expect(bayesUsersActionFor('edge')).toBe('valkey_eval_bayes_users');
  });

  it('rejects an unknown or missing release', () => {
    expect(() => bayesUsersActionFor(undefined)).toThrow(
      "Unknown DMS_RELEASE 'undefined'"
    );
    expect(() => bayesUsersActionFor('latest')).toThrow(
      "Unknown DMS_RELEASE 'latest'"
    );
  });
});

describe('getRspamdBayesUsers', () => {
  const EVAL_OUTPUT = 'anja@nytt.no 469 243\nolen@nytt.no 120 80\n';

  const execForRelease = (dmsRelease) => async (action) => {
    if (action === 'print_env') {
      return {
        returncode: 0,
        stdout: `HOSTNAME=mail\nDMS_RELEASE=${dmsRelease}\n`,
        stderr: '',
      };
    }
    return { returncode: 0, stdout: EVAL_OUTPUT, stderr: '' };
  };

  it('queries Valkey on DMS v17 and parses the counts', async () => {
    mockExecAction.mockImplementation(execForRelease('v17.0.0'));
    const result = await getRspamdBayesUsers('mailserver', 'mail');
    expect(mockExecAction.mock.calls.map((call) => call[0])).toEqual([
      'print_env',
      'valkey_eval_bayes_users',
    ]);
    expect(result).toEqual({
      success: true,
      message: [
        { user: 'anja@nytt.no', ham: 469, spam: 243 },
        { user: 'olen@nytt.no', ham: 120, spam: 80 },
      ],
    });
  });

  it('queries Redis on DMS v16', async () => {
    mockExecAction.mockImplementation(execForRelease('v16.0.1'));
    await getRspamdBayesUsers('mailserver', 'mail');
    expect(mockExecAction.mock.calls[1][0]).toBe('redis_eval_bayes_users');
  });

  it('fails without querying when DMS_RELEASE is missing', async () => {
    mockExecAction.mockResolvedValue({
      returncode: 0,
      stdout: 'HOSTNAME=mail\n',
      stderr: '',
    });
    const result = await getRspamdBayesUsers('mailserver', 'mail');
    expect(result).toEqual({
      success: false,
      error: "Unknown DMS_RELEASE 'undefined'",
    });
    expect(mockExecAction).toHaveBeenCalledTimes(1);
  });
});
