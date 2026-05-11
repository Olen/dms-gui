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
}));

vi.mock('./demoMode.mjs', () => ({
  demoResponse: vi.fn(() => null),
}));

import { getMailBounces } from './mailLogs.mjs';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMailBounces — grep_postfix_bounces returncode handling', () => {
  // The route-level mailbounces endpoint relies on grep exit-code
  // semantics for "no matches" vs "real error". A regression here is
  // hard to spot in production because the response shape is the same
  // ({success:true,message:...} vs {success:false,error:...}); the
  // assertions below lock the per-rc branches in.

  it('rc=0 with stdout parses bounce lines and returns a summary', async () => {
    // Timestamp generated inside the cutoff window (default 48h)
    const ts = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const isoLine = `${ts} mail postfix/smtp[1234]: ABCDEF: to=<bob@example.com>, relay=mx.example.com[1.2.3.4]:25, delay=2.1, delays=0.1/0/1/1, dsn=5.1.1, status=bounced (host mx.example.com[1.2.3.4] said: 550 5.1.1 No such user)`;
    mockExecAction.mockResolvedValue({
      returncode: 0,
      stdout: isoLine,
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r.success).toBe(true);
    expect(r.message.summary).toEqual({ bounced: 1, deferred: 0 });
    expect(r.message.bounces).toHaveLength(1);
    expect(r.message.bounces[0]).toMatchObject({
      to: 'bob@example.com',
      status: 'bounced',
    });
    // dsn extraction uses a `\d+\.\d+\.\d+` regex on the reason
    // string, which is greedy and matches the first dotted triplet —
    // can be an IP rather than the DSN. Pre-existing quirk; outside
    // the scope of these regression tests for rc handling.
  });

  it('rc=1 returns success with empty bounces (grep "no matches")', async () => {
    mockExecAction.mockResolvedValue({
      returncode: 1,
      stdout: '',
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r).toEqual({
      success: true,
      message: { bounces: [], summary: { bounced: 0, deferred: 0 } },
    });
  });

  it('rc=2 surfaces an error even when stderr is empty', async () => {
    // grep rc=2 == "invalid argument / I/O error". Before the round-2
    // fix, this was masked as success-with-empty because stderr was
    // empty — the regression test pins the new behaviour.
    mockExecAction.mockResolvedValue({
      returncode: 2,
      stdout: '',
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/grep_postfix_bounces exited with code 2/);
  });

  it('non-zero rc with stderr passes the stderr message through', async () => {
    mockExecAction.mockResolvedValue({
      returncode: 127,
      stdout: '',
      stderr: 'sh: grep: command not found',
    });

    const r = await getMailBounces('dms', 48);

    expect(r).toEqual({
      success: false,
      error: 'sh: grep: command not found',
    });
  });

  it('requires a containerName', async () => {
    const r = await getMailBounces(null, 48);
    expect(r).toEqual({
      success: false,
      error: 'containerName is required',
    });
    expect(mockExecAction).not.toHaveBeenCalled();
  });
});
