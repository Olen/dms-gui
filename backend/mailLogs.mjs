// Mail-server log + bounce queries. Extracted from settings.mjs's
// god-module during the #82 split. Re-exported from settings.mjs so
// existing call sites don't churn.

import { errorLog, execAction } from './backend.mjs';
import { demoResponse } from './demoMode.mjs';
import { getTargetDict } from './db.mjs';

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

// Parse a BSD-syslog timestamp ("Mar  6 09:24:34" — possibly with
// double space before single-digit days) into a Date.
//
// BSD syslog carries no year. Strategy: try the current calendar
// year first; if the result is more than 12 hours in the future
// (almost certainly because we just crossed a year boundary), back
// off to the previous year. The 12-hour buffer absorbs minor clock
// skew between the log source and dms-gui without re-classifying
// genuinely-future entries as last-year.
//
// `now` is injected so tests can pin a stable reference time.
const parseBsdTimestamp = (tsStr, now = new Date()) => {
  const parts = tsStr.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [mon, day, time] = parts;
  const monthIdx = MONTHS[mon];
  if (monthIdx === undefined) return null;
  const [h, m, s] = time.split(':').map(Number);
  if ([h, m, s].some((n) => Number.isNaN(n))) return null;
  const dayNum = Number(day);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) return null;

  let dt = new Date(now.getFullYear(), monthIdx, dayNum, h, m, s);
  if (isNaN(dt.getTime())) return null;
  if (dt.getTime() > now.getTime() + 12 * 3600 * 1000) {
    dt = new Date(now.getFullYear() - 1, monthIdx, dayNum, h, m, s);
  }
  return dt;
};

export const getMailLogs = async (
  containerName = null,
  source = 'mail',
  lines = 100
) => {
  if (!containerName)
    return { success: false, error: 'containerName is required' };

  const validSources = {
    mail: '/var/log/mail/mail.log',
    rspamd: '/var/log/mail/rspamd.log',
  };
  const logFile = validSources[source];
  if (!logFile)
    return { success: false, error: `Invalid log source: ${source}` };

  const numLines = Math.min(Math.max(parseInt(lines) || 100, 10), 500);

  const demo = demoResponse('mailLogs');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict('mailserver', containerName);
    const results = await execAction(
      'tail_log',
      { lines: String(numLines), logfile: logFile },
      targetDict,
      { timeout: 10 }
    );

    if (!results.returncode && results.stdout) {
      return {
        success: true,
        message: results.stdout.split('\n').filter((l) => l.length > 0),
      };
    } else if (!results.returncode && !results.stdout) {
      return { success: true, message: [] };
    }
    return { success: false, error: results.stderr || 'Failed to read logs' };
  } catch (error) {
    errorLog(error.message);
    return { success: false, error: error.message };
  }
};

// Function to get bounced/deferred outgoing mail from DMS container
export const getMailBounces = async (containerName = null, hours = 48) => {
  if (!containerName)
    return { success: false, error: 'containerName is required' };

  const maxHours = Math.min(Math.max(parseInt(hours) || 48, 1), 168);

  const demo = demoResponse('mailBounces');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict('mailserver', containerName);
    const results = await execAction('grep_postfix_bounces', {}, targetDict, {
      timeout: 10,
    });

    // grep exits 1 only when there are no matching lines — treat that
    // (and only that) as success-with-empty-result. Any other non-zero
    // exit code is a real error (rc=2 == grep failure, rc=126/127 ==
    // exec failure, anything else == unexpected) and must surface to
    // the caller even when stderr happens to be empty.
    if (results.returncode === 1) {
      return {
        success: true,
        message: { bounces: [], summary: { bounced: 0, deferred: 0 } },
      };
    }
    if (results.returncode) {
      return {
        success: false,
        error:
          results.stderr ||
          `grep_postfix_bounces exited with code ${results.returncode}`,
      };
    }

    const lines = (results.stdout || '')
      .split('\n')
      .filter((l) => l.length > 0);
    const cutoff = new Date(Date.now() - maxHours * 3600 * 1000);

    // Parse postfix smtp bounce/defer lines. Try ISO 8601 first
    // (modern systemd-journal-fed DMS) and fall back to BSD syslog
    // ("Mar  6 09:24:34 mail ..." — three space-separated tokens, no
    // year). Bare bash `postfix` writing to /var/log/mail.log emits
    // the BSD form; without it those lines would silently disappear
    // from the bounces report.
    const TAIL_RE =
      /\s+\S+\s+postfix\/smtp\[\d+\]:\s+([A-F0-9]+):\s+to=<([^>]*)>(?:,\s+orig_to=<([^>]*)>)?,.*?status=(\w+)\s+\((.+)\)$/;
    const ISO_LINE_RE = new RegExp('^(\\S+)' + TAIL_RE.source);
    const BSD_LINE_RE = new RegExp('^(\\S+\\s+\\S+\\s+\\S+)' + TAIL_RE.source);

    const now = new Date();
    const byQueueId = new Map();
    for (const line of lines) {
      let tsStr, queueId, to, origTo, status, reason;
      let ts;

      const iso = line.match(ISO_LINE_RE);
      if (iso) {
        [, tsStr, queueId, to, origTo, status, reason] = iso;
        ts = new Date(tsStr);
      } else {
        const bsd = line.match(BSD_LINE_RE);
        if (!bsd) continue;
        [, tsStr, queueId, to, origTo, status, reason] = bsd;
        ts = parseBsdTimestamp(tsStr, now);
      }
      if (!ts || isNaN(ts.getTime())) continue;

      if (ts < cutoff) continue;

      const dsn = reason.match(/(\d+\.\d+\.\d+)/)?.[1] || '';

      byQueueId.set(queueId, {
        time: ts.toISOString(),
        to,
        origTo: origTo || null,
        dsn,
        status,
        reason,
      });
    }

    const bounces = [...byQueueId.values()].sort((a, b) =>
      b.time.localeCompare(a.time)
    );
    const summary = {
      bounced: bounces.filter((b) => b.status === 'bounced').length,
      deferred: bounces.filter((b) => b.status === 'deferred').length,
    };

    return { success: true, message: { bounces, summary } };
  } catch (error) {
    errorLog(error.message);
    return { success: false, error: error.message };
  }
};
