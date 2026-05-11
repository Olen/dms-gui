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

import { getRspamdConfig } from './rspamd.mjs';

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
