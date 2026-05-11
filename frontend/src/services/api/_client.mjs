// Shared axios instance + request() helper used by every per-domain
// module under services/api/. Exporting `api` (the axios instance)
// alongside `request` lets the rare special-case caller (uploadLogo's
// multipart/form-data) bypass the helper when needed.

import axios from 'axios';

import { debugLog, errorLog } from '../../../frontend.mjs';

// API_URL is injected at build time by vite.config.js's `define` block.
// `process.env.API_URL` becomes a string literal during the build, so
// no runtime `process` object exists in the browser bundle. The `|| '/api'`
// guards the same-origin default for callers that didn't set the env var.
const API_URL = process.env.API_URL || '/api';

export const api = axios.create({
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
// request() — generic wrapper used by every export in services/api/*.
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

export const request = async (method, path, options = {}) => {
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
