// Dovecot session lookup via `doveadm who`. Extracted from
// settings.mjs's god-module during the #82 split. Re-exported back
// through settings.mjs so existing call sites don't churn.

import { debugLog, errorLog, execAction } from './backend.mjs';
import { demoResponse } from './demoMode.mjs';
import { getTargetDict } from './db.mjs';

/**
 * Get active Dovecot IMAP/POP3 sessions via `doveadm who`
 * Returns sessions grouped by username with connection count and IPs
 */
export const getDovecotSessions = async (
  plugin = 'mailserver',
  containerName = null
) => {
  debugLog(`getDovecotSessions containerName=${containerName}`);
  if (!containerName)
    return {
      success: false,
      error: 'getDovecotSessions: containerName is required',
    };

  const demo = demoResponse('dovecotSessions');
  if (demo) return demo;

  try {
    const targetDict = getTargetDict(plugin, containerName);
    const result = await execAction('doveadm_who', {}, targetDict, {
      timeout: 5,
    });

    if (result.returncode) {
      return { success: false, error: result.stderr || 'doveadm who failed' };
    }

    // Parse `doveadm who` output:
    // username                 # proto (pids) (ips)
    // user@domain.com          2 imap  (1234 5678) (192.168.1.1 10.0.0.1)
    const sessions = {};
    const lines = (result.stdout || '').split('\n').filter((l) => l.trim());

    for (const line of lines) {
      // Skip header line
      if (line.startsWith('username')) continue;

      // Parse: username  connections  service  (pids)  (ips)
      const match = line.match(
        /^(\S+)\s+(\d+)\s+(\S+)\s+\([^)]*\)\s+\(([^)]*)\)/
      );
      if (match) {
        const [, username, connections, service, ips] = match;
        if (!sessions[username]) {
          sessions[username] = {
            username,
            connections: 0,
            services: [],
            ips: [],
          };
        }
        sessions[username].connections += parseInt(connections);
        if (!sessions[username].services.includes(service)) {
          sessions[username].services.push(service);
        }
        const ipList = ips.split(/\s+/).filter(Boolean);
        for (const ip of ipList) {
          if (!sessions[username].ips.includes(ip)) {
            sessions[username].ips.push(ip);
          }
        }
      }
    }

    return { success: true, message: Object.values(sessions) };
  } catch (error) {
    errorLog(`getDovecotSessions error:`, error.message);
    return { success: false, error: error.message };
  }
};
