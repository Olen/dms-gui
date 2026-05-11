// Mail-server log + bounce queries. Extracted from settings.mjs's
// god-module during the #82 split. Re-exported from settings.mjs so
// existing call sites don't churn.

import { errorLog, execAction } from './backend.mjs';
import { demoResponse } from './demoMode.mjs';
import { getTargetDict } from './db.mjs';

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

    // Parse postfix smtp bounce/defer lines. The capture group requires
    // the timestamp to be a single whitespace-free token, which fits
    // modern DMS output (ISO 8601, e.g.
    // "2026-03-06T09:24:34.123456+01:00 mail postfix/smtp[1234]: ...").
    // Legacy BSD-syslog timestamps ("Mar  6 09:24:34 mail ...") have
    // three whitespace-separated parts and are not parsed by this
    // regex; modern systemd-journal-fed DMS doesn't emit them, but if
    // that ever changes a second regex + year/timezone injection is
    // needed (BSD syslog has no year).
    const lineRe =
      /^(\S+)\s+\S+\s+postfix\/smtp\[\d+\]:\s+([A-F0-9]+):\s+to=<([^>]*)>(?:,\s+orig_to=<([^>]*)>)?,.*?status=(\w+)\s+\((.+)\)$/;

    const byQueueId = new Map();
    for (const line of lines) {
      const m = line.match(lineRe);
      if (!m) continue;

      const [, tsStr, queueId, to, origTo, status, reason] = m;
      const ts = new Date(tsStr);
      if (isNaN(ts.getTime())) continue;

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
