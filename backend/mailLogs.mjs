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

    if (results.returncode && !results.stdout) {
      // grep returns 1 when no matches — that's normal
      return {
        success: true,
        message: { bounces: [], summary: { bounced: 0, deferred: 0 } },
      };
    }
    if (results.returncode && results.stderr) {
      return { success: false, error: results.stderr };
    }

    const lines = (results.stdout || '')
      .split('\n')
      .filter((l) => l.length > 0);
    const cutoff = new Date(Date.now() - maxHours * 3600 * 1000);

    // Parse postfix smtp bounce/defer lines — supports both timestamp formats:
    // ISO 8601: "2026-03-06T09:24:34.123456+01:00 mail postfix/smtp[1234]: QUEUEID: ..."
    // BSD syslog: "Mar  6 09:24:34 mail postfix/smtp[1234]: QUEUEID: ..."
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
