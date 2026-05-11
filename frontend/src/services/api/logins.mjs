// Logins (dms-gui login users) + roles lookup.
// Mirrors backend/routes/logins.js.

import { request } from './_client.mjs';

export const getLogins = async (ids) =>
  request('post', '/getLogins', { body: { ids } });

export const addLogin = async (
  mailbox,
  username,
  password,
  email,
  isAdmin = 0,
  isAccount = 0,
  isActive = 1,
  mailserver,
  roles = []
) =>
  request('put', '/logins', {
    requires: { mailbox, username, password },
    body: {
      mailbox,
      username,
      password,
      email,
      isAdmin,
      isActive,
      isAccount,
      mailserver,
      roles,
    },
  });

export const updateLogin = async (id, jsonDict) =>
  request('patch', `/logins/${id}`, {
    requires: { id, jsonDict },
    body: jsonDict,
  });

export const deleteLogin = async (id) =>
  request('delete', `/logins/${id}`, { requires: { id } });

// TBD — not currently referenced by any page; kept until the
// "Set roles" UI lands or until a follow-up audit decides to drop it.
export const getRoles = async (credential) =>
  request('get', `/roles/${credential}`, { requires: { credential } });
