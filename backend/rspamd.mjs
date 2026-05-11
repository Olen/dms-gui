// Rspamd integration: stats, config, Bayes users, counters, history,
// learn endpoint. Extracted from settings.mjs's god-module during the
// #82 split — about 600 lines, by far the biggest cohesive group.
// Re-exported from settings.mjs so existing call sites don't churn.

import { debugLog, errorLog, execAction } from './backend.mjs';
import { demoResponse, demoWriteResponse } from './demoMode.mjs';
import { dbAll, dbGet, dbRun, getTargetDict, sql } from './db.mjs';

// Rspamd stats via internal HTTP API (port 11334 inside container)
export const getRspamdStats = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getRspamdStats containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdStats: containerName is required',
    };

  const demo = demoResponse('rspamdStats');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);
    const result = await execAction('curl_rspamd_stat', {}, targetDict, {
      timeout: 5,
    });

    if (!result.returncode && result.stdout) {
      const stat = JSON.parse(result.stdout);
      return { success: true, message: stat };
    }
    return {
      success: false,
      error: result.stderr || 'rspamd stat request failed',
    };
  } catch (error) {
    errorLog(`getRspamdStats error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Read-only rspamd config: action thresholds and Bayes autolearn settings
export const getRspamdConfig = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getRspamdConfig containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdConfig: containerName is required',
    };

  const demo = demoResponse('rspamdConfig');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);

    // Read config files — try override.d first, fall back to local.d
    // cat_rspamd_config validates path against a fixed enum in the manifest.
    let actionsText = '';
    let bayesText = '';
    try {
      const r = await execAction(
        'cat_rspamd_config',
        { path: '/etc/rspamd/override.d/actions.conf' },
        targetDict,
        { timeout: 5 }
      );
      if (!r.returncode) actionsText = r.stdout || '';
    } catch (e) {
      /* file not found */
    }
    if (!actionsText) {
      try {
        const r = await execAction(
          'cat_rspamd_config',
          { path: '/etc/rspamd/local.d/actions.conf' },
          targetDict,
          { timeout: 5 }
        );
        if (!r.returncode) actionsText = r.stdout || '';
      } catch (e) {
        /* file not found */
      }
    }
    // Mirror the actions.conf precedence: override.d first, fall
    // back to local.d. (Pre-#82 the bayes block had them reversed,
    // which silently misreported the effective config whenever both
    // files were present — rspamd loads override.d after local.d so
    // override.d settings win at runtime, and we should match that.)
    try {
      const r = await execAction(
        'cat_rspamd_config',
        { path: '/etc/rspamd/override.d/classifier-bayes.conf' },
        targetDict,
        { timeout: 5 }
      );
      if (!r.returncode) bayesText = r.stdout || '';
    } catch (e) {
      /* file not found */
    }
    if (!bayesText) {
      try {
        const r = await execAction(
          'cat_rspamd_config',
          { path: '/etc/rspamd/local.d/classifier-bayes.conf' },
          targetDict,
          { timeout: 5 }
        );
        if (!r.returncode) bayesText = r.stdout || '';
      } catch (e) {
        /* file not found */
      }
    }

    // Parse action thresholds: key = value; or key = null;
    const parseAction = (key) => {
      const m = actionsText.match(
        new RegExp(`^\\s*${key}\\s*=\\s*(null|[\\d.]+)\\s*;`, 'm')
      );
      return m ? (m[1] === 'null' ? null : parseFloat(m[1])) : undefined;
    };

    const actions = {
      reject: parseAction('reject'),
      add_header: parseAction('add_header'),
      greylist: parseAction('greylist'),
      rewrite_subject: parseAction('rewrite_subject'),
    };

    // Parse Bayes settings
    const minLearnsMatch = bayesText.match(/^\s*min_learns\s*=\s*(\d+)\s*;/m);
    const spamThreshMatch = bayesText.match(/score\s*>=\s*([\d.]+)/);
    const hamThreshMatch = bayesText.match(/score\s*<=\s*(-?[\d.]+)/);

    const bayes = {
      min_learns: minLearnsMatch ? parseInt(minLearnsMatch[1]) : undefined,
      spam_threshold: spamThreshMatch
        ? parseFloat(spamThreshMatch[1])
        : undefined,
      ham_threshold: hamThreshMatch ? parseFloat(hamThreshMatch[1]) : undefined,
    };

    return { success: true, message: { actions, bayes } };
  } catch (error) {
    errorLog(`getRspamdConfig error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Per-user Bayes learn statistics from Redis
// Returns an array of { user, ham, spam } sorted by user, plus a _total row
export const getRspamdBayesUsers = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getRspamdBayesUsers containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdBayesUsers: containerName is required',
    };

  const demo = demoResponse('rspamdBayesUsers');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);

    // The Lua script is baked into the manifest's redis_eval_bayes_users argv.
    const result = await execAction('redis_eval_bayes_users', {}, targetDict, {
      timeout: 10,
    });

    if (result.returncode) {
      return { success: false, error: result.stderr || 'Redis query failed' };
    }

    const lines = (result.stdout || '')
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    const users = lines.map((line) => {
      const [user, ham, spam] = line.trim().split(/\s+/);
      return { user, ham: parseInt(ham) || 0, spam: parseInt(spam) || 0 };
    });

    return { success: true, message: users };
  } catch (error) {
    errorLog(`getRspamdBayesUsers error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Rspamd top symbol counters (aggregated from history)
// Note: rspamd's history buffer defaults to 200 rows (in-memory) or is configured via
// history_redis.conf (nrows = N) when using the history_redis module. To increase the
// history depth, create config/rspamd/local.d/history_redis.conf with e.g. "nrows = 1000;"
// and recreate the DMS container. The /history endpoint returns all rows by default.
export const getRspamdCounters = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getRspamdCounters containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdCounters: containerName is required',
    };

  const demo = demoResponse('rspamdCounters');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);
    const result = await execAction('curl_rspamd_history', {}, targetDict, {
      timeout: 10,
    });

    if (!result.returncode && result.stdout) {
      const history = JSON.parse(result.stdout);
      const rows = history.rows || [];

      // Aggregate symbol scores split by polarity (positive vs negative)
      const symData = {};
      for (const row of rows) {
        for (const [name, info] of Object.entries(row.symbols || {})) {
          if (!symData[name])
            symData[name] = {
              symbol: name,
              hits: 0,
              posSum: 0,
              posCount: 0,
              negSum: 0,
              negCount: 0,
            };
          const s = symData[name];
          s.hits += 1;
          const score = info.score || 0;
          if (score > 0) {
            s.posSum += score;
            s.posCount += 1;
          } else if (score < 0) {
            s.negSum += score;
            s.negCount += 1;
          }
        }
      }

      // Build rows: dual-polarity symbols get two rows (+/-), others get one
      // Skip symbols that never contribute to the score
      const output = [];
      for (const s of Object.values(symData)) {
        const hasBoth = s.posCount > 0 && s.negCount > 0;
        if (s.posCount > 0) {
          output.push({
            symbol: s.symbol,
            direction: hasBoth ? '+' : null,
            hits: hasBoth ? s.posCount : s.hits,
            avgScore: s.posSum / s.posCount,
            frequency:
              rows.length > 0
                ? (hasBoth ? s.posCount : s.hits) / rows.length
                : 0,
          });
        }
        if (s.negCount > 0) {
          output.push({
            symbol: s.symbol,
            direction: hasBoth ? '−' : null,
            hits: hasBoth ? s.negCount : s.hits,
            avgScore: s.negSum / s.negCount,
            frequency:
              rows.length > 0
                ? (hasBoth ? s.negCount : s.hits) / rows.length
                : 0,
          });
        }
      }
      // Sort by absolute average score (highest impact first)
      output.sort((a, b) => Math.abs(b.avgScore) - Math.abs(a.avgScore));
      return { success: true, message: output.slice(0, 40) };
    }
    return {
      success: false,
      error: result.stderr || 'rspamd history request failed',
    };
  } catch (error) {
    errorLog(`getRspamdCounters error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Per-user rspamd history summary from /history endpoint
// addresses: array of email addresses to match (mailbox + aliases)
export const getRspamdUserHistory = async (
  plugin = 'mailserver',
  containerName = null,
  addresses = []
) => {
  debugLog(
    `getRspamdUserHistory containerName=${containerName} addresses=${addresses.length}`
  );
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdUserHistory: containerName is required',
    };
  if (!addresses.length)
    return {
      success: false,
      error: 'getRspamdUserHistory: addresses is required',
    };

  const demo = demoResponse('rspamdUserHistory');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);
    const result = await execAction('curl_rspamd_history', {}, targetDict, {
      timeout: 10,
    });

    if (!result.returncode && result.stdout) {
      const history = JSON.parse(result.stdout);
      const rows = history.rows || [];

      // Filter rows where any recipient matches user's mailbox or aliases
      // rcpt_smtp and rcpt_mime are arrays of strings
      const addrSet = new Set(addresses.map((a) => a.toLowerCase()));
      const matchesUser = (field) => {
        if (!field) return false;
        if (Array.isArray(field))
          return field.some((r) => addrSet.has(r.toLowerCase()));
        return addrSet.has(String(field).toLowerCase());
      };
      const userRows = rows.filter(
        (row) => matchesUser(row.rcpt_smtp) || matchesUser(row.rcpt_mime)
      );

      const total = userRows.length;
      const spam = userRows.filter(
        (r) =>
          r.action === 'add header' ||
          r.action === 'reject' ||
          r.action === 'rewrite subject'
      ).length;
      const ham = userRows.filter((r) => r.action === 'no action').length;

      const scores = userRows.map((r) => r.score || 0);
      const avgScore =
        total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;

      // Oldest entry timestamp
      const since =
        userRows.length > 0
          ? Math.min(...userRows.map((r) => r.unix_time || Infinity))
          : null;

      // Find which address matched for a row
      const getMatchedRcpt = (row) => {
        for (const r of row.rcpt_smtp || []) {
          if (addrSet.has(r.toLowerCase())) return r;
        }
        for (const r of row.rcpt_mime || []) {
          if (addrSet.has(r.toLowerCase())) return r;
        }
        return (row.rcpt_smtp || [])[0] || '';
      };

      // Recent spam (last 10 items with positive score)
      const recentSpam = userRows
        .filter((r) => (r.score || 0) > 0 && r.action !== 'no action')
        .sort((a, b) => (b.unix_time || 0) - (a.unix_time || 0))
        .slice(0, 10)
        .map((r) => ({
          subject: r.subject || '(no subject)',
          score: r.score,
          time: r.unix_time,
          action: r.action,
          rcpt: getMatchedRcpt(r),
        }));

      return {
        success: true,
        message: { total, ham, spam, avgScore, since, recentSpam },
      };
    }
    return {
      success: false,
      error: result.stderr || 'rspamd history request failed',
    };
  } catch (error) {
    errorLog(`getRspamdUserHistory error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Rspamd message history with Bayes learned status from DB
export const getRspamdHistory = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getRspamdHistory containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getRspamdHistory: containerName is required',
    };

  const demo = demoResponse('rspamdHistory');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);
    const result = await execAction('curl_rspamd_history', {}, targetDict, {
      timeout: 10,
    });

    if (!result.returncode && result.stdout) {
      const history = JSON.parse(result.stdout);
      const rawRows = history.rows || [];

      const rows = rawRows.map((r) => {
        const symbols = r.symbols || {};
        const bayesSym = symbols['BAYES_SPAM'] || symbols['BAYES_HAM'];
        return {
          message_id: r['message-id'] || '',
          sender: r.sender_smtp || r.sender_mime || '',
          rcpt: Array.isArray(r.rcpt_smtp)
            ? r.rcpt_smtp.join(', ')
            : r.rcpt_smtp || '',
          subject: r.subject || '',
          score: r.score || 0,
          bayes: bayesSym ? bayesSym.score : null,
          action: r.action || '',
          unix_time: r.unix_time || 0,
        };
      });

      // Extract thresholds from first row (same for all rows)
      const firstRow = rawRows[0];
      const thresholds = firstRow?.thresholds || {};

      // Build learnedMap from DB
      const learnedMap = {};
      const dbResult = dbAll(sql.bayesLearned.select.allMap, {
        name: containerName,
      });
      if (dbResult.success && dbResult.message) {
        for (const row of dbResult.message) {
          learnedMap[row.message_id] = row.action;
        }
      }

      return { success: true, message: { rows, learnedMap, thresholds } };
    }
    return {
      success: false,
      error: result.stderr || 'rspamd history request failed',
    };
  } catch (error) {
    errorLog(`getRspamdHistory error:`, error.message);
    return { success: false, error: error.message };
  }
};

// Learn a message as ham or spam via doveadm + rspamd
// Uses separate execAction calls via rspamd_learn / rspamd_unlearn pipeline actions.
export const rspamdLearnMessage = async (
  plugin = 'mailserver',
  containerName = null,
  messageId = null,
  action = null,
  learnedBy = 'admin'
) => {
  debugLog(
    `rspamdLearnMessage containerName=${containerName} messageId=${messageId} action=${action}`
  );
  if (!containerName)
    return { success: false, error: 'containerName is required' };
  if (!messageId) return { success: false, error: 'message_id is required' };
  if (!action || !['ham', 'spam'].includes(action))
    return { success: false, error: 'action must be ham or spam' };

  const demo = demoWriteResponse(`Learn request submitted as ${action}`);
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);

    // Step 1: Find message in dovecot via doveadm search
    // Timeout 30s: -A searches all users, which can be slow on first (cold) query
    const searchResult = await execAction(
      'doveadm_search_message_id',
      { message_id: messageId },
      targetDict,
      { timeout: 30 }
    );

    if (
      searchResult.returncode ||
      !searchResult.stdout ||
      !searchResult.stdout.trim()
    ) {
      return {
        success: false,
        error:
          'Message not found in any mailbox (may have been deleted or rejected)',
      };
    }

    // Parse first match: "user guid uid"
    const firstLine = searchResult.stdout.trim().split('\n')[0];
    const parts = firstLine.split(/\s+/);
    if (parts.length < 3) {
      return { success: false, error: 'Unexpected doveadm search output' };
    }
    const [user, guid, uid] = parts;

    // Validate guid (hex) and uid (numeric) from doveadm output
    if (!/^[0-9a-f]+$/i.test(guid) || !/^\d+$/.test(uid)) {
      return { success: false, error: 'Invalid guid/uid format from doveadm' };
    }

    // Step 2: If previously learned as opposite class, unlearn first
    const dbCheck = dbGet(
      sql.bayesLearned.select.byMsgId,
      { name: containerName },
      messageId
    );
    const previousAction =
      dbCheck.success && dbCheck.message ? dbCheck.message.action : null;

    if (
      previousAction &&
      previousAction !== action &&
      ['ham', 'spam'].includes(previousAction)
    ) {
      const unlearnResult = await execAction(
        'rspamd_unlearn',
        { user, guid, uid: parseInt(uid, 10), action: previousAction },
        targetDict,
        { timeout: 10 }
      );
      debugLog(
        `Unlearn ${previousAction} result: rc=${unlearnResult.returncode} stdout=${unlearnResult.stdout}`
      );
    }

    // Step 3: Learn as ham or spam (pipe doveadm output directly into curl via stdin)
    // The manifest pipeline omits curl's -w '%{http_code}' (the {http_code} placeholder
    // would be misinterpreted by the action interpreter). Failure is detected via
    // curl's exit code (result.returncode) instead.
    const learnResult = await execAction(
      'rspamd_learn',
      { user, guid, uid: parseInt(uid, 10), action },
      targetDict,
      { timeout: 10 }
    );

    if (learnResult.returncode) {
      return {
        success: false,
        error: `Learn failed: ${learnResult.stderr || 'unknown error'}`,
      };
    }

    // Step 4: Record in DB
    dbRun(
      sql.bayesLearned.insert.learned,
      {
        message_id: messageId,
        action: action,
        user: user,
        learned_by: learnedBy,
      },
      containerName
    );

    // Note: the 200/204 distinction (Learned vs Already known) was dropped
    // because curl's -w '%{http_code}' format string contains {http_code},
    // which the action interpreter treats as a placeholder. If this distinction
    // is needed in future, use `curl -D -` (dump headers to stdout) and parse
    // the first header line.
    return {
      success: true,
      message: `Learn request submitted as ${action}`,
      action,
    };
  } catch (error) {
    errorLog(`rspamdLearnMessage error:`, error.message);
    return { success: false, error: error.message };
  }
};
