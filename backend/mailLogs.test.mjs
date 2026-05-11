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

describe('getMailBounces — BSD-syslog timestamp parsing (#109)', () => {
  // BSD-syslog format: "Mar  6 09:24:34 mail postfix/smtp[1234]: ..."
  // Plain `postfix` writing to /var/log/mail.log emits this; modern
  // systemd-journal-fed DMS uses ISO 8601. The parser tries ISO first
  // and falls back to BSD via parseBsdTimestamp (which injects the
  // current year, with year-rollover handling).
  //
  // The tests build BSD lines relative to a `now` reference so they
  // stay inside the 48h cutoff regardless of when the suite runs.
  // BSD has no timezone marker; new Date(year, mon, day, h, m, s)
  // builds a *local-time* Date, so the test computes the BSD string
  // from a Date in local time too.

  const formatBsdLocal = (date) => {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const mon = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, ' ');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${mon} ${day} ${hh}:${mm}:${ss}`;
  };

  it('parses a BSD-syslog bounce line', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const bsdTs = formatBsdLocal(oneHourAgo);
    const bsdLine = `${bsdTs} mail postfix/smtp[1234]: ABCDEF: to=<alice@example.com>, relay=mx.example.com[1.2.3.4]:25, delay=2.1, delays=0.1/0/1/1, dsn=5.1.1, status=deferred (delivery temporarily suspended: connect to mx.example.com[1.2.3.4]:25: Connection refused)`;
    mockExecAction.mockResolvedValue({
      returncode: 0,
      stdout: bsdLine,
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r.success).toBe(true);
    expect(r.message.summary).toEqual({ bounced: 0, deferred: 1 });
    expect(r.message.bounces).toHaveLength(1);
    expect(r.message.bounces[0]).toMatchObject({
      to: 'alice@example.com',
      status: 'deferred',
    });
  });

  it('handles a mix of ISO and BSD lines in the same response', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isoLine = `${oneHourAgo.toISOString()} mail postfix/smtp[1234]: AAAAAA: to=<iso@example.com>, status=bounced (no user)`;
    const bsdLine = `${formatBsdLocal(twoHoursAgo)} mail postfix/smtp[5678]: BBBBBB: to=<bsd@example.com>, status=bounced (no user)`;
    mockExecAction.mockResolvedValue({
      returncode: 0,
      stdout: `${isoLine}\n${bsdLine}`,
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r.success).toBe(true);
    expect(r.message.bounces).toHaveLength(2);
    const recipients = r.message.bounces.map((b) => b.to).sort();
    expect(recipients).toEqual(['bsd@example.com', 'iso@example.com']);
  });

  it('skips lines older than the cutoff window', async () => {
    // BSD timestamps from 100 days ago should be filtered by the
    // maxHours cutoff. parseBsdTimestamp will read it as ~3 months
    // ago (this year), and the cutoff (48h) excludes it.
    const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const bsdLine = `${formatBsdLocal(longAgo)} mail postfix/smtp[1234]: ABCDEF: to=<old@example.com>, status=bounced (no user)`;
    mockExecAction.mockResolvedValue({
      returncode: 0,
      stdout: bsdLine,
      stderr: '',
    });

    const r = await getMailBounces('dms', 48);

    expect(r.success).toBe(true);
    expect(r.message.bounces).toHaveLength(0);
  });
});
