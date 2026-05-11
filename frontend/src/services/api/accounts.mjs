// Email accounts + doveadm + quota + sieve rules.
// Mirrors backend/routes/accounts.js.

import { request } from './_client.mjs';

export const getAccounts = async (containerName = null, refresh = false) => {
  const params = {};
  if (refresh !== undefined) params.refresh = refresh;
  return request('get', `/accounts/${containerName}`, {
    requires: { containerName },
    params,
  });
};

export const addAccount = async (
  schema,
  containerName,
  mailbox,
  password,
  createLogin
) =>
  request('post', `/accounts/${schema}/${containerName}`, {
    requires: { schema, containerName, mailbox, password },
    body: { mailbox, password, createLogin },
  });

export const deleteAccount = async (schema, containerName, mailbox) =>
  request('delete', `/accounts/${schema}/${containerName}/${mailbox}`, {
    // mailbox is a URL segment — without this check a missing value
    // would produce a request to `/accounts/.../undefined`. All other
    // account endpoints already require mailbox; this aligns
    // deleteAccount with the pattern.
    requires: { schema, containerName, mailbox },
  });

export const doveadm = async (
  schema,
  containerName,
  command,
  mailbox,
  jsonDict = {}
) =>
  request('put', `/doveadm/${schema}/${containerName}/${command}/${mailbox}`, {
    requires: { schema, containerName, command, mailbox },
    body: jsonDict,
  });

export const updateAccount = async (schema, containerName, mailbox, jsonDict) =>
  request('patch', `/accounts/${schema}/${containerName}/${mailbox}`, {
    requires: { schema, containerName, mailbox },
    body: jsonDict,
  });

export const setAccountQuota = async (containerName, mailbox, quota) =>
  request('put', `/accounts/${containerName}/${mailbox}/quota`, {
    requires: { containerName, mailbox },
    body: { quota },
  });

// ============================================
// Sieve rules — backend routes them under /sieve but they're
// per-account and live in routes/accounts.js, so we keep them
// here too.
// ============================================

export const getSieveRules = async (containerName, mailbox) =>
  request('get', `/sieve/${containerName}/${mailbox}`, {
    requires: { containerName, mailbox },
  });

export const saveSieveRules = async (containerName, mailbox, rules) =>
  request('put', `/sieve/${containerName}/${mailbox}`, {
    requires: { containerName, mailbox },
    body: { rules },
  });

export const deleteSieveRules = async (containerName, mailbox) =>
  request('delete', `/sieve/${containerName}/${mailbox}`, {
    requires: { containerName, mailbox },
  });
