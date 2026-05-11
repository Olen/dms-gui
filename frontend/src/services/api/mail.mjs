// Mail-adjacent endpoints: rspamd, dovecot sessions, password
// generation, per-user rspamd summary. Mirrors backend/routes/mail.js.

import { request } from './_client.mjs';

export const getRspamdUserSummary = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/user-summary`, {
    requires: { containerName },
  });

export const generatePassword = async (words = 4) =>
  request('get', '/generate-password', { params: { words } });

export const getDovecotSessions = async (containerName = null) =>
  request('get', `/dovecot/${containerName}/sessions`, {
    requires: { containerName },
  });

// ============================================
// Rspamd
// ============================================

export const getRspamdStats = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/stat`, {
    requires: { containerName },
  });

export const getRspamdCounters = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/counters`, {
    requires: { containerName },
  });

export const getRspamdBayesUsers = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/bayes-users`, {
    requires: { containerName },
  });

export const getRspamdConfig = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/config`, {
    requires: { containerName },
  });

export const getRspamdHistory = async (containerName = null) =>
  request('get', `/rspamd/${containerName}/history`, {
    requires: { containerName },
  });

export const rspamdLearnMessage = async (
  containerName = null,
  message_id,
  action
) =>
  request('post', `/rspamd/${containerName}/learn`, {
    requires: { containerName, message_id, action },
    body: { message_id, action },
  });
