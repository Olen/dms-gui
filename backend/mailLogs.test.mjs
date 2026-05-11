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

import { getMailBounces, parseBsdTimestamp } from './mailLogs.mjs';

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

describe('parseBsdTimestamp — round-trip validation + year rollover', () => {
  // BSD syslog has no year, no native invalid-date guard. JS's
  // `new Date(year, month, day, h, m, s)` happily normalises Apr 31
  // to May 1 and 99:99:99 to the next day — silent misparsing that
  // would skew the bounce report if not caught.

  // Fixed reference time so the year-rollover branches are deterministic.
  const REF = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00 local

  it('parses a well-formed timestamp in the current year', () => {
    const ts = parseBsdTimestamp('Mar  6 09:24:34', REF);
    expect(ts).not.toBeNull();
    expect(ts.getFullYear()).toBe(2026);
    expect(ts.getMonth()).toBe(2); // March
    expect(ts.getDate()).toBe(6);
    expect(ts.getHours()).toBe(9);
  });

  it('rolls a future date back to previous year', () => {
    // Dec 31 of "this year" lies > 12h in the future from REF (June).
    // Without the rollover branch the entry would land 6 months ahead.
    const ts = parseBsdTimestamp('Dec 31 23:00:00', REF);
    expect(ts).not.toBeNull();
    expect(ts.getFullYear()).toBe(2025);
    expect(ts.getMonth()).toBe(11);
    expect(ts.getDate()).toBe(31);
  });

  it('keeps an entry inside the 12h future buffer in the current year', () => {
    // 6 hours ahead of REF — still "today", not last year.
    const sixHoursAhead = new Date(REF.getTime() + 6 * 3600 * 1000);
    const month = [
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
    ][sixHoursAhead.getMonth()];
    const tsStr = `${month} ${String(sixHoursAhead.getDate()).padStart(2, ' ')} ${String(sixHoursAhead.getHours()).padStart(2, '0')}:00:00`;
    const ts = parseBsdTimestamp(tsStr, REF);
    expect(ts).not.toBeNull();
    expect(ts.getFullYear()).toBe(2026);
  });

  it('rejects Apr 31 (JS would silently roll it to May 1)', () => {
    expect(parseBsdTimestamp('Apr 31 12:00:00', REF)).toBeNull();
  });

  it('rejects Feb 30 in a leap year (still invalid)', () => {
    // 2024 is a leap year, so REF.year - 2 with Feb 30 must still reject.
    const leapRef = new Date(2024, 5, 15, 12, 0, 0);
    expect(parseBsdTimestamp('Feb 30 12:00:00', leapRef)).toBeNull();
  });

  it('rejects out-of-range hour (24)', () => {
    expect(parseBsdTimestamp('Mar  6 24:00:00', REF)).toBeNull();
  });

  it('rejects out-of-range minutes (60)', () => {
    expect(parseBsdTimestamp('Mar  6 23:60:00', REF)).toBeNull();
  });

  it('rejects out-of-range seconds (60)', () => {
    expect(parseBsdTimestamp('Mar  6 23:00:60', REF)).toBeNull();
  });

  it('rejects unknown month name', () => {
    expect(parseBsdTimestamp('Foo  6 09:24:34', REF)).toBeNull();
  });

  it('rejects non-numeric time components', () => {
    expect(parseBsdTimestamp('Mar  6 ab:cd:ef', REF)).toBeNull();
  });

  it('rejects wrong number of whitespace-separated tokens', () => {
    expect(parseBsdTimestamp('Mar 6', REF)).toBeNull();
    expect(parseBsdTimestamp('Mar  6 12:00:00 extra', REF)).toBeNull();
  });

  it('rejects wrong number of colon-separated time components', () => {
    expect(parseBsdTimestamp('Mar  6 12:00', REF)).toBeNull();
    expect(parseBsdTimestamp('Mar  6 12:00:00:00', REF)).toBeNull();
  });
});
