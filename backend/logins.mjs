import {
  debugLog,
  errorLog,
  execAction,
  infoLog,
  successLog,
  warnLog,
} from './backend.mjs';

import {
  dbAll,
  dbGet,
  dbRun,
  getTargetDict,
  hashPassword,
  sql,
  verifyPassword,
} from './db.mjs';
import { demoResponse, demoWriteResponse } from './demoMode.mjs';

// Look up a login row by id AND a stored refresh-token cookie. Used by
// the /auth/refresh endpoint to verify that a presented refresh token
// still matches what we recorded at login (so a stale or rotated token
// can be rejected even if it would otherwise pass JWT verification).
// Returns the login row or null.
export const findLoginByRefreshToken = (id, refreshToken) => {
  if (!id || !refreshToken) return null;
  try {
    const result = dbGet(sql.logins.select.refreshToken, id, {
      refreshToken,
    });
    return result.success ? result.message : null;
  } catch (error) {
    errorLog('findLoginByRefreshToken', error.message);
    return null;
  }
};

// this returns an objects
export const getLogin = async (credential, guess = false) => {
  let login = {
    success: false,
    message: 'invalid credential: neither string nor object',
  };
  try {
    // We accept:
    //   - an object {id|mailbox|username: value} → looked up via the
    //     matching static-statement (see the dispatch below);
    //   - a string credential, with semantics that depend on `guess`:
    //       guess=true  → mailbox-OR-username (loginGuess statement,
    //                      used by the login flow and password-reset
    //                      lookups where users may type either).
    //       guess=false → mailbox only (loginByMailbox statement; the
    //                      #39 fix). The previous {[sql.logins.id]:
    //                      credential} form keyed by primary-key id
    //                      and silently returned 0 rows for any
    //                      mailbox-shape input.
    if (typeof credential === 'string') {
      // loginGuess should only be used for login purposes, and takes a string
      if (guess) {
        login = dbGet(sql.logins.select.loginGuess, {
          mailbox: credential,
          username: credential,
        });
      } else {
        login = dbGet(sql.logins.select.loginByMailbox, {
          mailbox: credential,
        });
      }
    } else if (
      typeof credential === 'object' &&
      Object.keys(credential).length === 1
    ) {
      const key = Object.keys(credential)[0];
      // Static-statement dispatch — replaces a previous string-replace into
      // the SQL template (loginObj.replace("{key}", key)) which would have
      // been an SQL-injection vector if a future caller bypassed the
      // allowlist below. Object.hasOwn ensures inherited keys
      // (__proto__, toString, …) are rejected: a plain `dispatch[key]`
      // lookup would return inherited prototype props, slip past the
      // truthy guard, and dbGet() would then receive a non-string.
      const dispatch = {
        id: sql.logins.select.login,
        mailbox: sql.logins.select.loginByMailbox,
        username: sql.logins.select.loginByUsername,
      };
      if (!Object.hasOwn(dispatch, key)) {
        return { success: false, message: 'invalid credential key' };
      }
      login = dbGet(dispatch[key], credential);
    }
    if (login.success) {
      if (login.message && Object.keys(login.message).length) {
        infoLog(`Found login ${credential}:`, {
          isAdmin: login.message.isAdmin,
          isActive: login.message.isActive,
          isAccount: login.message.isAccount,
          roles: login.message.roles,
        });

        // now JSON.parse roles as it's stored stringified in the db
        login.message.roles = login.message?.roles
          ? JSON.parse(login.message.roles)
          : [];
      } else login.success = false;
    }
    return login;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// this returns an array of objects, credentials is either mailbox or username, or array of those, or an object like {id:id}|{mailbox:mailbox}|{username:username}, or array of those
export const getLogins = async (credentials = null, guess = false) => {
  debugLog(credentials, guess);
  if (credentials && !Array.isArray(credentials))
    return getLogin(credentials, guess);

  const demo = demoResponse('logins');
  if (demo) return demo;

  let result;
  let logins = [];
  try {
    debugLog(`credentials=`, credentials);
    if (Array.isArray(credentials) && credentials.length) {
      // roles come already parsed from getLogin
      logins = await Promise.all(
        credentials.map(async (credential) => {
          const login = await getLogin(credential, guess);
          if (login.success) return login?.message || null;
        })
      );
      infoLog(`Found ${logins.length} entries in logins for`, credentials);

      if (logins.length) {
        // now remove all undefined entries
        logins = logins.filter((element) => element !== null);
      }
    } else {
      result = dbAll(sql.logins.select.logins);
      if (result.success) {
        // now JSON.parse roles as it's stored stringified in the db
        logins = result.message.map((login) => {
          return { ...login, roles: JSON.parse(login.roles) };
        });
        infoLog(`Found ${logins.length} entries in logins`);
      }
    }

    // we could read DB_Logins and it is valid
    if (!logins.length) warnLog(`db logins seems empty:`, logins);

    return { success: true, message: logins };
    // {success: true, message: [ {mailbox: mailbox, username: username, email: email, isActive:1, ..}, ..] }
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// this returns an array
export const getRoles = async (credential = null) => {
  let roles = { success: false };
  try {
    // String credential = mailbox. The route GET /api/roles/:credential
    // restricts non-admins to req.user.mailbox, so the contract here is
    // mailbox-shaped. The previous form keyed by primary-key id and
    // silently returned 0 rows for any mailbox input.
    if (typeof credential === 'string') {
      roles = dbGet(sql.logins.select.rolesByMailbox, { mailbox: credential });
    } else if (
      typeof credential === 'object' &&
      Object.keys(credential).length === 1
    ) {
      const key = Object.keys(credential)[0];
      // Static-statement dispatch with own-property check (see getLogin
      // for why Object.hasOwn matters — rejects inherited keys like
      // __proto__/toString).
      const dispatch = {
        id: sql.logins.select.roles,
        mailbox: sql.logins.select.rolesByMailbox,
        username: sql.logins.select.rolesByUsername,
      };
      if (!Object.hasOwn(dispatch, key)) {
        return { success: false, message: 'invalid credential key' };
      }
      roles = dbGet(dispatch[key], credential);
    }
    if (roles.success) {
      return { success: true, message: JSON.parse(roles.message) };
    }
    return roles;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// mailserver used to be containerName, now we want configID
export const addLogin = async (
  mailbox,
  username,
  password = '',
  email = '',
  isAdmin = 0,
  isAccount = 0,
  isActive = 1,
  mailserver = null,
  roles = []
) => {
  debugLog(
    mailbox,
    username,
    '[REDACTED]',
    email,
    isAdmin,
    isActive,
    isAccount,
    mailserver,
    roles
  );

  const demo = demoWriteResponse(`Login created: ${username}`);
  if (demo) return demo;

  try {
    // even when password is undefined, we can get a hash value
    const { salt, hash } = await hashPassword(password ?? '');
    // login:    `REPLACE INTO logins  (mailbox, username, email, salt, hash, isAdmin, isAccount, isActive, mailserver, roles) VALUES (@mailbox, @username, @email, @salt, @hash, @isAdmin, @isAccount, @isActive, @mailserver, @roles)`,
    const result = dbRun(sql.logins.insert.login, {
      mailbox: mailbox,
      username: username,
      email: email,
      salt: salt,
      hash: hash,
      isAdmin: isAdmin,
      isAccount: isAccount,
      isActive: isActive,
      mailserver: mailserver,
      roles: JSON.stringify(roles),
    });
    if (result.success) {
      successLog(`Saved login ${username}:${mailbox}`);
    }
    return result;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// loginUser will not throw an error an attacker can exploit
export const loginUser = async (credential = null, password = '') => {
  let login, isValid, results, message;
  try {
    login = await getLogin(credential, true);

    if (login.success) {
      if (login.message.isActive) {
        if (login.message.isAccount) {
          if (login.message.mailserver) {
            const targetDict = getTargetDict(
              'mailserver',
              login.message.mailserver
            );
            targetDict.timeout = 5;
            results = await execAction(
              'doveadm_auth_test',
              { mailbox: login.message.mailbox, password },
              targetDict
            );
            if (!results.returncode) {
              successLog(`${credential} logged in successfully`);
            } else {
              message = `${credential} password invalid`;
              warnLog(message);
              login.message = message;
              login.success = false;
            }
          } else {
            message = `${credential} mailbox does not have a mailserver assigned yet, where do we log that one?`;
            errorLog(message);
            login.success = false;
            login.message = message;
          }
        } else {
          isValid = await verifyPassword(credential, password, 'logins');
          if (isValid) {
            successLog(`User ${credential} logged in successfully`);
          } else {
            message = `User ${credential} password invalid`;
            warnLog(message);
            login.message = message;
            login.success = false;
          }
        }
      } else {
        message = `User ${credential} is inactive`;
        warnLog(message);
        login.message = message;
        login.success = false;
      }
    } else {
      message = `${credential} does not exist`;
      warnLog(message);
      login.message = message;
    }

    return login;
  } catch (error) {
    errorLog(error.message);
    throw new Error(error.message);
    // throw new Error(backendError);

    // TODO: we should return smth to the index API instead of throwing an error
    // return {
    // status: 'unknown',
    // error: error.message,
    // };
  }
};

// module.exports = {
//   getLogin,
//   getLogins,
//   addLogin,
//   loginUser,
//   getRoles,
// };
