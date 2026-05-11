import axios from 'axios';

import { debugLog, errorLog } from '../../frontend.mjs';

// API_URL is injected at build time by vite.config.js's `define` block.
// `process.env.API_URL` becomes a string literal during the build, so
// no runtime `process` object exists in the browser bundle. The `|| '/api'`
// guards the same-origin default for callers that didn't set the env var.
const API_URL = process.env.API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Security with HTTP-Only Cookie
  // CSRF double-submit cookie. axios reads the named cookie
  // value and forwards it as the named header on every request,
  // matching the requireCsrf middleware on the backend. The cookie
  // itself is set non-httpOnly server-side at /loginUser and
  // /refresh so it's readable here.
  //
  // withXSRFToken: true forces axios to attach the header even on
  // cross-origin requests. By default it only does so same-origin;
  // production runs same-origin via nginx, but dev (`API_URL` set to
  // an absolute URL like http://localhost:3001 from a different
  // dev-server origin) would otherwise drop the header silently and
  // every state-changing request would 403. Explicit > implicit.
  xsrfCookieName: 'xsrfToken',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  withXSRFToken: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================
// Axios response interceptor with automatic token refresh.
// ============================================
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const errorCode = error.response?.data?.code;

    // If access token expired, try to refresh
    if (errorCode === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue this request while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => {
            return api(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await api.post('/refresh');

        isRefreshing = false;
        processQueue(null);

        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        processQueue(refreshError);

        // Refresh failed - redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    // Handle other errors
    switch (errorCode) {
      case 'NO_TOKEN':
      case 'INVALID_TOKEN':
      case 'NO_REFRESH_TOKEN':
      case 'INVALID_REFRESH_TOKEN':
      case 'REFRESH_TOKEN_EXPIRED':
      case 'ERR_BAD_REQUEST':
        window.location.href = '/login';
        break;

      case 'FORBIDDEN':
        console.error('Permission denied');
        break;

      case 'ACCOUNT_INACTIVE':
        alert('Your account is inactive. Please contact support.');
        break;

      default:
        console.error(
          'API Error:',
          error.response?.data?.error || 'Unknown error'
        );
    }

    return Promise.reject(error);
  }
);

// ============================================
// request() — generic wrapper used by every export below.
// ============================================
//
// Returns response.data on success, throws on HTTP error after
// errorLog'ing. The `requires` map shortcuts to a {success:false}
// shape when any value is falsy — mirroring the inline guards
// every export used to do by hand.
//
// Most exports collapse to a single `return request(method, path, opts)`.
// The few "silent-failure" exports (getBranding, forgotPassword,
// validateResetToken, testDnsProvider, pushDnsRecord, getDkimSelector)
// wrap their request() call in try/catch to substitute a fallback
// shape — the silence is intentional (UX / info-disclosure
// prevention) and is now explicit at each silent-failure site.
// Reduce a full request path to its route family (first non-empty
// segment) for logging. Avoids leaking user identifiers embedded in
// the URL — `/accounts/dms/mailserver/user@test.com` → `/accounts`,
// `/roles/admin@example.com` → `/roles`. Path-shape detail beyond
// the first segment is rarely useful for debugging from the browser
// console (the network tab already shows full URLs).
const routeFamily = (path) => {
  const m = path.match(/^\/?([^/]+)/);
  return m ? `/${m[1]}` : path;
};

const request = async (method, path, options = {}) => {
  const { body, params, requires, headers } = options;
  if (requires) {
    for (const [name, val] of Object.entries(requires)) {
      if (!val) return { success: false, error: `${name} is required` };
    }
  }
  try {
    debugLog(`api ${method.toUpperCase()} ${routeFamily(path)}`);
    const config = { method, url: path };
    if (body !== undefined) config.data = body;
    if (params) config.params = params;
    if (headers) config.headers = headers;
    const response = await api(config);
    return response.data;
  } catch (error) {
    errorLog(
      `api ${method.toUpperCase()} ${routeFamily(path)}: ${error.message}`
    );
    throw error;
  }
};

// ============================================
// Server / status
// ============================================

export const getServerStatus = async (
  plugin,
  containerName,
  test = undefined,
  settings = []
) => {
  const params = {};
  if (test !== undefined) params.test = test;
  return request('post', `/status/${plugin}/${containerName}`, {
    requires: { containerName },
    body: { settings },
    params,
  });
};

export const getServerEnvs = async (
  plugin,
  containerName,
  refresh = false,
  name
) => {
  const params = {};
  if (refresh !== undefined) params.refresh = refresh;
  if (name !== undefined) params.name = name;
  return request('get', `/envs/${plugin}/${containerName}`, {
    requires: { containerName },
    params,
  });
};

export const getNodeInfos = async () => request('get', '/infos');

// ============================================
// Settings / configs
// ============================================

export const getSettings = async (
  plugin,
  containerName,
  name,
  encrypted = false,
  scope
) => {
  const params = { encrypted };
  if (name !== undefined) params.name = name;
  const path = scope
    ? `/settings/${plugin}/${containerName}/${scope}`
    : `/settings/${plugin}/${containerName}`;
  return request('get', path, { requires: { containerName }, params });
};

export const getConfigs = async (plugin, name) => {
  const path = name ? `/configs/${plugin}/${name}` : `/configs/${plugin}`;
  return request('get', path);
};

export const saveSettings = async (
  plugin,
  schema,
  scope,
  containerName,
  jsonArrayOfObjects,
  encrypted = false
) =>
  request('post', `/settings/${plugin}/${schema}/${scope}/${containerName}`, {
    requires: { containerName },
    body: jsonArrayOfObjects,
    params: { encrypted },
  });

// ============================================
// Logins
// ============================================

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

// ============================================
// Auth
// ============================================

export const loginUser = async (credential, password, test = false) => {
  // Distinctive contract: returns `false` (not an error object) when
  // args are missing, because the Login page checks for that shape.
  if (!credential || !password) return false;
  return request('post', '/loginUser', { body: { credential, password, test } });
};

export const logoutUser = async () => request('post', '/logout');

// ============================================
// Accounts
// ============================================

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
    requires: { schema, containerName },
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
// Sieve rules
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

// ============================================
// Aliases
// ============================================

export const getAliases = async (containerName = null, refresh = false) => {
  const params = {};
  if (refresh !== undefined) params.refresh = refresh;
  return request('get', `/aliases/${containerName}`, {
    requires: { containerName },
    params,
  });
};

export const addAlias = async (containerName = null, source, destination) =>
  request('post', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });

export const deleteAlias = async (containerName = null, source, destination) =>
  // DELETE-with-body — required because regex aliases can contain
  // chars that aren't safe as URL path segments.
  request('delete', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });

export const updateAlias = async (containerName = null, source, destination) =>
  request('put', `/aliases/${containerName}`, {
    requires: { containerName },
    body: { source, destination },
  });

// ============================================
// Mail (logs / bounces / rspamd)
// ============================================

export const getMailLogs = async (
  containerName = null,
  source = 'mail',
  lines = 100
) =>
  request('get', `/logs/${containerName}`, {
    requires: { containerName },
    params: { source, lines },
  });

export const getMailBounces = async (containerName = null, hours = 48) =>
  request('get', `/bounces/${containerName}`, {
    requires: { containerName },
    params: { hours },
  });

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

export const getUserSettings = async (containerName = null) =>
  request('get', `/user-settings/${containerName}`, {
    requires: { containerName },
  });

// ============================================
// Domains / DNS
// ============================================

export const getDomains = async (containerName = null, name) => {
  const path = name
    ? `/domains/${containerName}/${name}`
    : `/domains/${containerName}`;
  return request('get', path, { requires: { containerName } });
};

export const updateDomain = async (containerName, domain, jsonDict) =>
  request('patch', `/domains/${containerName}/${domain}`, {
    requires: { containerName, domain },
    body: jsonDict,
  });

export const getDnsLookup = async (containerName = null, domain) =>
  request('get', `/dns/${containerName}/${domain}`, {
    requires: { containerName, domain },
  });

export const getDkimSelector = async (containerName) => {
  // Silent-failure: this is read on the Domains page for every
  // domain row; a network blip shouldn't blank the UI. Fall back
  // to the project default selector so the page still renders.
  // Both fallback branches return success:true so callers can rely
  // on `result.selector` unconditionally — the success flag is a
  // promise that a usable selector came back, not a claim about
  // whether the DB had one.
  if (!containerName) return { success: true, selector: 'mail' };
  try {
    return await request('get', `/domains/${containerName}/dkim-selector`);
  } catch {
    return { success: true, selector: 'mail' };
  }
};

export const generateDkim = async (containerName, domain, options = {}) =>
  request('post', `/domains/${containerName}/${domain}/dkim`, {
    requires: { containerName, domain },
    body: options,
  });

export const getDnsblCheck = async (containerName, domain) =>
  request('get', `/dnsbl/${containerName}/${domain}`, {
    requires: { containerName, domain },
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

// ============================================
// Misc admin
// ============================================

export const getCount = async (table, containerName) =>
  request('get', `/getCount/${table}/${containerName}`, {
    requires: { table },
  });

// TBD — not currently referenced by any page; kept until the
// "Set roles" UI lands or until a follow-up audit decides to drop it.
export const getRoles = async (credential) =>
  request('get', `/roles/${credential}`, { requires: { credential } });

// initAPI to define or generate a new DMS_API_KEY
export const initAPI = async (plugin, schema, containerName, dms_api_key_param) => {
  const params = {};
  if (dms_api_key_param !== undefined) params.dms_api_key_param = dms_api_key_param;
  return request('post', `/initAPI/${plugin}/${schema}/${containerName}`, {
    requires: { containerName },
    body: params,
  });
};

// kill will reboot this container
// eslint-disable-next-line no-unused-vars -- args kept for caller-API compatibility while server expects no path/body
export const killContainer = async (plugin, schema, containerName) =>
  request('post', '/killContainer');

// ============================================
// Branding (public — no auth)
// ============================================

export const getBranding = async (containerName) => {
  // Silent-failure: the login page calls this BEFORE the user is
  // authenticated. A 5xx must not break the login screen.
  const path = containerName ? `/branding/${containerName}` : '/branding';
  try {
    return await request('get', path);
  } catch {
    return { success: true, message: [] };
  }
};

export const uploadLogo = async (file, scope) => {
  // Caller owns error handling here — uploadLogo is exclusively
  // called from the admin Settings page, which surfaces failures
  // via its own form-error UI. Routing this through request()
  // (which errorLogs + throws) would double-log every failure.
  const formData = new FormData();
  formData.append('logo', file);
  const p = scope ? `/branding/logo/${scope}` : '/branding/logo';
  const response = await api.post(p, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteLogo = async (scope) => {
  // Same contract as uploadLogo — caller handles errors.
  const p = scope ? `/branding/logo/${scope}` : '/branding/logo';
  const response = await api.delete(p);
  return response.data;
};

// ============================================
// Password reset — public endpoints (no auth)
// ============================================

export const forgotPassword = async (email) => {
  // Always return success to prevent account-enumeration via
  // timing or response-shape differences. This is a deliberate
  // security contract, not a degraded-error path.
  try {
    return await request('post', '/forgot-password', { body: { email } });
  } catch {
    return {
      success: true,
      message: 'If that account exists, a reset link has been sent.',
    };
  }
};

export const validateResetToken = async (token) => {
  // Silent-failure: rendered on the ResetPassword page; any
  // network/server problem maps to "Invalid or expired token"
  // so the user sees a single coherent error.
  try {
    return await request('post', '/validate-reset-token', { body: { token } });
  } catch {
    return { success: false, error: 'Invalid or expired token' };
  }
};

export const resetPassword = async (token, password) =>
  request('post', '/reset-password', { body: { token, password } });

// ============================================
// DNS provider tests / pushes
// ============================================

export const testDnsProvider = async (credentials) => {
  // Silent-failure: the UI shows the error message inline rather
  // than throwing; prefer the server's structured error over the
  // raw HTTP message.
  try {
    return await request('post', '/dnscontrol/test', { body: credentials });
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
};

export const pushDnsRecord = async (containerName, domain, record) => {
  // Silent-failure: same UX contract as testDnsProvider.
  try {
    return await request(
      'post',
      `/dnscontrol/${containerName}/${domain}/records`,
      { body: record }
    );
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message,
    };
  }
};

export default api;
